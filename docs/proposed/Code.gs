// TEMPLATE: fill API_KEY and SPREADSHEET_ID locally before deploying.
// Do not commit real credentials to this repository.

// =====================================================
// TOFUSENSE - GOOGLE SHEETS RECEIVER
// Explicit Spreadsheet ID + Testing Tab
// =====================================================

const API_KEY = 'PASTE_API_KEY';

const SPREADSHEET_ID =
  'PASTE_SPREADSHEET_ID';

const SHEET_NAME = 'testing';

const HEADERS = [
  'received_at',
  'sample_id',
  'sampled_at',
  'temp1',
  'humid1',
  'tvoc1',
  'temp2',
  'humid2',
  'tvoc2',
  'vbat'
];

// =====================================================
// DIAGNOSTIC - OPEN /exec IN BROWSER
// =====================================================

function doGet() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);

    return out({
      ok: true,
      message: 'TofuSense Apps Script is running',
      spreadsheet: ss.getName(),
      spreadsheet_id: ss.getId(),
      sheet: SHEET_NAME,
      sheet_found: !!sheet,
      last_row: sheet ? sheet.getLastRow() : null
    });

  } catch (err) {
    return out({
      ok: false,
      error: String(err)
    });
  }
}

// =====================================================
// MAIN POST ENDPOINT
// =====================================================

function doPost(e) {

  const lock = LockService.getScriptLock();
  let locked = false;

  try {

    if (!e || !e.postData || !e.postData.contents) {
      return out({
        ok: false,
        error: 'Empty request body'
      });
    }

    lock.waitLock(10000);
    locked = true;

    const d = JSON.parse(e.postData.contents);

    // API KEY VALIDATION
    if (d.api_key !== API_KEY) {
      return out({
        ok: false,
        error: 'Invalid API key'
      });
    }

    // SAMPLE ID VALIDATION
    if (!d.sample_id) {
      return out({
        ok: false,
        error: 'Missing sample_id'
      });
    }

    // EXPLICIT SPREADSHEET TARGET
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    const sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      return out({
        ok: false,
        error: 'Target sheet not found',
        spreadsheet: ss.getName(),
        sheet: SHEET_NAME
      });
    }

    // CREATE HEADER IF EMPTY
    if (sheet.getLastRow() === 0) {

      sheet.getRange(1, 1, 1, HEADERS.length)
        .setValues([HEADERS]);

      sheet.getRange(1, 1, 1, HEADERS.length)
        .setFontWeight('bold');

      sheet.setFrozenRows(1);
    }

    // DUPLICATE DETECTION
    const lastRow = sheet.getLastRow();

    if (lastRow >= 2) {

      const duplicate = sheet
        .getRange(2, 2, lastRow - 1, 1)
        .createTextFinder(String(d.sample_id))
        .matchEntireCell(true)
        .findNext();

      if (duplicate) {

        return out({
          ok: true,
          duplicate: true,
          sample_id: String(d.sample_id),
          spreadsheet: ss.getName(),
          sheet: SHEET_NAME
        });
      }
    }

    // PREPARE DATA
    const row = [
      new Date(),
      String(d.sample_id),
      d.sampled_at || '',

      val(d.temp1, -40, 125),
      val(d.humid1, 0, 100),
      val(d.tvoc1, 0, 99999),

      val(d.temp2, -40, 125),
      val(d.humid2, 0, 100),
      val(d.tvoc2, 0, 99999),

      val(d.vbat, 0, 100)
    ];

    // REJECT IF ALL SENSOR VALUES ARE INVALID
    if (row.slice(3, 9).every(v => v === '')) {
      return out({
        ok: false,
        error: 'No valid sensor values'
      });
    }

    // WRITE TO EXPLICIT TARGET SHEET
    const nextRow = sheet.getLastRow() + 1;

    if (nextRow > sheet.getMaxRows()) {
      sheet.insertRowsAfter(
        sheet.getMaxRows(),
        nextRow - sheet.getMaxRows()
      );
    }

    sheet.getRange(nextRow, 1, 1, HEADERS.length)
      .setValues([row]);

    SpreadsheetApp.flush();

    return out({
      ok: true,
      duplicate: false,
      row: nextRow,
      sample_id: String(d.sample_id),
      spreadsheet: ss.getName(),
      spreadsheet_id: ss.getId(),
      sheet: SHEET_NAME
    });

  } catch (err) {

    return out({
      ok: false,
      error: String(err)
    });

  } finally {

    if (locked) {
      lock.releaseLock();
    }
  }
}

// =====================================================
// VALUE VALIDATION
// =====================================================

function val(x, min, max) {

  if (
    x === undefined ||
    x === null ||
    x === '' ||
    isNaN(x)
  ) {
    return '';
  }

  x = Number(x);

  return (x < min || x > max) ? '' : x;
}

// =====================================================
// JSON RESPONSE
// =====================================================

function out(obj) {

  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
