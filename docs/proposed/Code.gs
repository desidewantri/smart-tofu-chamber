// =====================================================
// TOFUSENSE - GOOGLE SHEETS RECEIVER
// Explicit Spreadsheet ID + target `test` tab (not deployed)
// =====================================================

const API_KEY = 'PASTE_API_KEY'; // set in Apps Script before deployment

const SPREADSHEET_ID =
  'PASTE_SPREADSHEET_ID';

const SHEET_NAME = 'test';

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

/**
 * Strict ISO-8601 with an explicit timezone. Returns a normalized UTC ISO
 * string, or null for invalid/date-only values.
 */
function normalizeIsoTimestamp(value) {
  const text = String(value || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!m) return null;
  const calendar = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  if (
    calendar.getUTCFullYear() !== +m[1] ||
    calendar.getUTCMonth() + 1 !== +m[2] ||
    calendar.getUTCDate() !== +m[3] ||
    calendar.getUTCHours() !== +m[4] ||
    calendar.getUTCMinutes() !== +m[5] ||
    calendar.getUTCSeconds() !== +m[6]
  ) {
    return null;
  }
  const d = new Date(text);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Exact validated target sample_id format:
 * tofusense-YYYYMMDDTHHMMSSmmmZ-<uuid>
 * Returns a UTC ISO string only for that exact format.
 */
function sampleIdTimestamp(sampleId) {
  const text = String(sampleId || '').trim();
  const m = /^tofusense-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(text);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]));
  if (isNaN(d.getTime())) return null;
  if (
    d.getUTCFullYear() !== +m[1] ||
    d.getUTCMonth() + 1 !== +m[2] ||
    d.getUTCDate() !== +m[3] ||
    d.getUTCHours() !== +m[4] ||
    d.getUTCMinutes() !== +m[5] ||
    d.getUTCSeconds() !== +m[6]
  ) {
    return null;
  }
  return d.toISOString();
}

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
    // received_at is always a full UTC timestamp. sampled_at is never replaced
    // by received_at; it comes from a valid ISO value or the exact validated
    // sample_id timestamp, otherwise it stays blank and is reported as a defect.
    const receivedAt = new Date().toISOString();
    const sampledRaw = String(d.sampled_at || '').trim();
    const sampledNormalized = normalizeIsoTimestamp(sampledRaw);
    const sampleTimestamp = !sampledRaw ? sampleIdTimestamp(d.sample_id) : null;
    const sampledAt = sampledNormalized || sampleTimestamp || '';
    const timestampDefect = sampledNormalized
      ? null
      : sampledRaw
        ? 'SAMPLED_AT_INVALID'
        : sampleTimestamp
          ? 'SAMPLED_AT_FROM_SAMPLE_ID'
          : 'SAMPLED_AT_MISSING';

    const row = [
      receivedAt,
      String(d.sample_id),
      sampledAt,

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
      sheet: SHEET_NAME,
      received_at: receivedAt,
      sampled_at: sampledAt || null,
      timestamp_defect: timestampDefect
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
