/**
 * Impor data sensor dari Google Sheet (CSV) ke aplikasi.
 *
 * Skema yang didukung (baris 1 = judul kolom, huruf besar/kecil bebas):
 *
 *   Baru (tab "testing"):
 *     received_at | sample_id | sampled_at | temp1 | humid1 | tvoc1
 *                 | temp2 | humid2 | tvoc2 | vbat
 *
 *   Lama:
 *     timestamp | temp1 | humid1 | tvoc1 | temp2 | humid2 | tvoc2 | vbat
 *
 * Pada skema lama, `timestamp` dibuat Apps Script dengan `new Date()` saat
 * request diterima. Nilainya adalah waktu terima, bukan waktu akuisisi sensor,
 * sehingga tidak pernah dipetakan ke `sampled_at`.
 *
 * Kolom berakhiran 1 -> Chamber 1, berakhiran 2 -> Chamber 2.
 *
 * Identitas event diturunkan dari `sample_id` + chamber, sama persis dengan
 * jalur MQTT. Karena MongoDB memiliki unique index pada eventId, baris Sheet
 * yang sudah masuk lewat MQTT otomatis ditolak sebagai duplikat. Cursor baris
 * (rowIndex) hanya optimisasi; kebenaran tetap dijaga oleh unique index.
 */
const env = require('../config/env');
const crypto = require('crypto');
const ImportCursor = require('../models/ImportCursor');
const ImportReceipt = require('../models/ImportReceipt');
const Chamber = require('../models/Chamber');
const SensorReading = require('../models/SensorReading');
const { ingestReading } = require('./ingestService');
const { parseBattery } = require('../utils/battery');
const { deriveEventId, sanitiseSampleId } = require('../utils/identity');

const CHAMBERS = [1, 2];
let timer = null;
let running = false;
let lastStatus = { enabled: false };

/* ---------- CSV ---------- */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Ubah link Google Sheet biasa menjadi link unduhan CSV. Link /pub?...output=csv dibiarkan. */
function toCsvUrl(url) {
  if (!url) return '';
  if (/output=csv|format=csv/.test(url)) return url;
  const m = /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(url);
  if (!m || m[1] === 'e') return url;
  const gid = /[#&?]gid=(\d+)/.exec(url);
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid[1]}` : ''}`;
}

/**
 * Apakah URL menunjuk tab tertentu lewat `gid`? Tanpa gid, Google Sheets
 * mengekspor tab pertama, yang bisa saja tab sesi historis.
 */
function hasExplicitGid(url) {
  return /[#&?]gid=\d+/.test(String(url || ''));
}

/** Angka: "32.27", "32,27", "3.451" (ribuan) tetap dibaca wajar. */
function toNumber(v) {
  let s = String(v ?? '').trim().replace(/\s/g, '');
  if (!s) return NaN;
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  else if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  return Number(s);
}

/**
 * Waktu dari Sheet ditulis dalam waktu lokal (default WIB, +07:00). Format yang dikenali:
 *  - 10/22/2026 21:34:43   (bulan/hari/tahun, format Sheet berbahasa Inggris)
 *  - 22/10/2026 21:34:43   (hari/bulan/tahun, bila SHEET_DATE_ORDER=dmy)
 *  - 2026-10-22 21:34:43 atau ISO lengkap
 */
function parseTimestamp(v, { offset = '+07:00', order = 'mdy' } = {}) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  let y; let mo; let d; let h; let mi; let se;
  if (m) {
    [, mo, d, y, h, mi, se] = m;
    if (order === 'dmy') [mo, d] = [d, mo];
  } else {
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (m) [, y, mo, d, h, mi, se] = m;
  }
  if (m) {
    const p = (x) => String(x || 0).padStart(2, '0');
    const t = new Date(`${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(se)}${offset}`);
    return Number.isNaN(t.getTime()) ? null : t;
  }
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? null : t;
}

/**
 * Ubah isi CSV menjadi daftar pembacaan.
 *
 * Setiap baris menghasilkan satu pembacaan per chamber yang kolomnya lengkap.
 *
 * Semantik waktu:
 *   - `sampled_at`  -> waktu akuisisi sensor (satu-satunya sumber `sampledAt`)
 *   - `received_at` -> waktu terima yang eksplisit
 *   - `timestamp`   -> skema lama: waktu terima Apps Script (bukan akuisisi)
 *   - `timestamp` efektif = `sampled_at` bila ada, jika tidak `received_at`.
 *
 * `sortTime` dipakai untuk cursor lama; `rowIndex` adalah posisi baris di CSV.
 */
const ISO_TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;
const SAMPLE_ID_TS_RE = /^tofusense-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strict ISO-8601 with an explicit timezone. Date-only values are rejected. */
function parseIsoTimestamp(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const m = ISO_TS_RE.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59 || +se > 59) {
    return null;
  }
  // Reject calendar-normalised values such as 2026-02-31.
  const calendar = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se));
  if (
    calendar.getUTCFullYear() !== +y ||
    calendar.getUTCMonth() + 1 !== +mo ||
    calendar.getUTCDate() !== +d ||
    calendar.getUTCHours() !== +h ||
    calendar.getUTCMinutes() !== +mi ||
    calendar.getUTCSeconds() !== +se
  ) {
    return null;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Exact sample_id timestamp format validated against the target Sheet:
 * tofusense-YYYYMMDDTHHMMSSmmmZ-<uuid>
 * This is the only sample_id form accepted as a measurement-time fallback.
 */
function extractSampleIdTimestamp(sampleId) {
  const text = String(sampleId ?? '').trim();
  const m = SAMPLE_ID_TS_RE.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, se, ms] = m;
  const parsed = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se, +ms));
  if (Number.isNaN(parsed.getTime())) return null;
  if (
    parsed.getUTCFullYear() !== +y ||
    parsed.getUTCMonth() + 1 !== +mo ||
    parsed.getUTCDate() !== +d ||
    parsed.getUTCHours() !== +h ||
    parsed.getUTCMinutes() !== +mi ||
    parsed.getUTCSeconds() !== +se
  ) {
    return null;
  }
  return parsed;
}

/**
 * Convert CSV rows to chamber readings.
 *
 * Timestamp policy for the new Apps Script schema:
 *   1. valid ISO-8601 `sampled_at` with explicit timezone
 *   2. exact validated `tofusense-<compact-UTC>-<uuid>` sample_id timestamp
 *   3. otherwise timestamp = null and the row is quarantined as timestamp-missing
 *
 * `received_at` is provenance/audit only. It is never substituted for
 * measurement time. Legacy `timestamp`-only sheets retain their historical
 * receipt-time behavior for backward compatibility.
 */
function rowsToReadings(rows, opts = {}) {
  if (!rows.length) return [];
  const head = rows[0].map((h) => String(h).trim().toLowerCase());
  const col = (names) => head.findIndex((h) => names.includes(h));

  const sampledIdx = col(['sampled_at', 'sampledat', 'waktu_sampel']);
  const tsIdx = col(['timestamp', 'waktu', 'time', 'tanggal']);
  const receivedIdx = col(['received_at', 'receivedat', 'diterima']);
  const sampleIdx = col(['sample_id', 'sampleid', 'id_sampel']);
  const legacyTimestampOnly = sampledIdx < 0 && receivedIdx < 0 && tsIdx >= 0;

  if (sampledIdx < 0 && tsIdx < 0 && receivedIdx < 0) {
    throw new Error(
      'Kolom waktu tidak ditemukan di baris pertama Sheet: sertakan "sampled_at", "received_at", atau "timestamp"'
    );
  }

  const map = CHAMBERS.map((n) => ({
    chamberId: n,
    suhu: col([`temp${n}`, `suhu${n}`, `temperature${n}`]),
    rh: col([`humid${n}`, `rh${n}`, `humidity${n}`, `kelembapan${n}`]),
    tvoc: col([`tvoc${n}`]),
    battery: (() => {
      const own = col([`battery${n}`, `baterai${n}`, `bat${n}`, `vbat${n}`]);
      return own >= 0 ? own : col(['vbat', 'battery', 'baterai', 'bat', 'batt', 'battery (%)', 'baterai (%)', 'v_bat']);
    })(),
  })).filter((c) => c.suhu >= 0 && c.rh >= 0 && c.tvoc >= 0);
  if (!map.length) throw new Error('Kolom temp1/humid1/tvoc1 (atau temp2/humid2/tvoc2) tidak ditemukan');

  const out = [];
  rows.slice(1).forEach((r, rowIndex) => {
    let sampleId = null;
    let sampleIdInvalid = null;
    if (sampleIdx >= 0) {
      const raw = String(r[sampleIdx] ?? '').trim();
      if (raw) {
        try {
          sampleId = sanitiseSampleId(raw);
        } catch {
          sampleIdInvalid = raw;
        }
      }
    }

    const sampledRaw = sampledIdx >= 0 ? String(r[sampledIdx] ?? '').trim() : '';
    const sampledAt = sampledRaw ? parseIsoTimestamp(sampledRaw) : null;
    const sampledInvalid = Boolean(sampledRaw) && !sampledAt;
    const explicitReceivedAt = receivedIdx >= 0 ? parseTimestamp(r[receivedIdx], opts) : null;
    const legacyReceivedAt = tsIdx >= 0 ? parseTimestamp(r[tsIdx], opts) : null;
    const receivedAt = explicitReceivedAt || legacyReceivedAt || null;
    const receivedRaw = receivedIdx >= 0 ? String(r[receivedIdx] ?? '') : '';
    // A date-only cell is provenance only; it cannot serve as a reliable
    // receipt clock for future-skew checks or stored receivedAt.
    const receivedAtHasTime = Boolean(
      (receivedRaw && /[T ]\d{1,2}:\d{2}/.test(receivedRaw)) ||
      (legacyTimestampOnly && legacyReceivedAt)
    );

    let timestamp = null;
    let timestampQuality = 'MISSING';
    let timestampSource = 'missing';
    if (legacyTimestampOnly) {
      // Backward compatibility for the legacy tab: its `timestamp` column is
      // the historical receipt time and was already used this way.
      timestamp = legacyReceivedAt;
      timestampQuality = 'MISSING';
      timestampSource = 'received_at';
    } else {
      const sampleIdTimestamp = !sampledAt
        ? extractSampleIdTimestamp(sampleId)
        : null;
      timestamp = sampledAt || sampleIdTimestamp || null;
      timestampQuality = sampledAt ? 'OK' : sampleIdTimestamp ? 'SAMPLE_ID' : sampledInvalid ? 'INVALID' : 'MISSING';
      timestampSource = sampledAt ? 'sampled' : sampleIdTimestamp ? 'sample_id' : 'missing';
    }

    // Preserve the legacy tab's historical behavior: a timestamp-only row
    // without a usable timestamp is skipped rather than quarantined.
    if (legacyTimestampOnly && !timestamp) return;

    for (const c of map) {
      const tvoc = toNumber(r[c.tvoc]);
      const suhu = toNumber(r[c.suhu]);
      const rh = toNumber(r[c.rh]);
      if ([tvoc, suhu, rh].some((x) => !Number.isFinite(x))) continue;
      const battery = c.battery >= 0 ? parseBattery(r[c.battery]) : null;
      out.push({
        chamberId: c.chamberId,
        rowIndex,
        sampleId,
        sampleIdInvalid,
        sampledAt: sampledAt || null,
        receivedAt,
        receivedAtHasTime,
        timestamp,
        timestampQuality,
        timestampSource,
        rawSampledAt: sampledRaw || null,
        rawReceivedAt: receivedIdx >= 0 ? String(r[receivedIdx] ?? '') : null,
        eventId: sampleId ? deriveEventId(sampleId, c.chamberId) : null,
        sortTime: legacyTimestampOnly ? (receivedAt || timestamp) : timestamp,
        tvoc,
        suhu,
        rh,
        battery,
      });
    }
  });
  return out.sort((a, b) => a.rowIndex - b.rowIndex || a.chamberId - b.chamberId);
}

/**
 * Pilih baris yang belum diproses untuk satu chamber.
 * Utamakan rowIndex (monoton, tahan terhadap sampled_at yang datang tidak urut).
 * Cursor lama berbasis timestamp tetap didukung.
 */
function selectFresh(readings, n, { last = null, since = null, cutoff = null, lastRowIndex = null } = {}) {
  if (Number.isInteger(lastRowIndex)) {
    return readings.filter((r) => r.chamberId === n && r.rowIndex > lastRowIndex);
  }
  return readings.filter((r) => {
    const when = r.sortTime || r.timestamp;
    return r.chamberId === n
      && (!last || when > last)
      && (!since || r.timestamp >= since)
      && (!cutoff || r.timestamp <= cutoff);
  });
}

/** Mode fallback untuk baris lama tanpa sample_id: apakah sudah ada data di sekitar waktu t? */
async function alreadyStored(chamberId, t, matchSec) {
  const ms = matchSec * 1000;
  const hit = await SensorReading.exists({
    chamberId,
    timestamp: { $gte: new Date(t.getTime() - ms), $lte: new Date(t.getTime() + ms) },
  });
  return Boolean(hit);
}

/* ---------- impor ---------- */
const TERMINAL_RECEIPT_STATUSES = new Set([
  'IMPORTED',
  'DUPLICATE',
  'QUARANTINED_INVALID',
  'UNASSIGNED',
  'QUARANTINED_INTEGRITY',
  'QUARANTINED_RETRY_EXHAUSTED',
]);
const MAX_RETRY_ATTEMPTS = 5;
const LEASE_MS = 5 * 60 * 1000;
const TVOC_SENTINEL = 99999;

function sourceIdFromUrl(url) {
  const text = String(url || '');
  // Published-to-web URLs use /d/e/<publishedId>/pub...; the published token is
  // what makes two spreadsheets distinct even when their tab gids collide.
  const published = /docs\.google\.com\/spreadsheets\/d\/e\/([a-zA-Z0-9_-]+)/.exec(text);
  if (published) {
    const gid = /[#&?]gid=(\d+)/.exec(text);
    return `e:${published[1]}:${gid ? gid[1] : '0'}`;
  }
  const m = /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(text);
  if (!m) return 'default:0';
  const gid = /[#&?]gid=(\d+)/.exec(text);
  return `${m[1]}:${gid ? gid[1] : '0'}`;
}

function cursorKeyFor(sourceId, chamberId) {
  return `sheet:${sourceId}:${chamberId}`;
}

function legacyCursorKey(chamberId) {
  return `sheet:${chamberId}`;
}

/**
 * Resolve a source-scoped cursor. Existing legacy `sheet:1`/`sheet:2` cursors
 * are copied to the scoped key only when SHEET_LEGACY_SOURCE_ID explicitly
 * identifies the legacy source. The old document is never deleted or modified.
 * Without that explicit mapping, the importer refuses to reuse an ambiguous
 * legacy cursor.
 */
async function ensureCursor(models, sourceId, chamberId, legacySourceId = '') {
  const Cursor = models.ImportCursor;
  const scopedKey = cursorKeyFor(sourceId, chamberId);
  const existing = await Cursor.findOne({ key: scopedKey });
  if (existing) return existing;

  const legacy = await Cursor.findOne({ key: legacyCursorKey(chamberId) });
  if (legacy) {
    if (!legacySourceId) {
      const err = new Error(
        'Legacy Sheet cursor exists but SHEET_LEGACY_SOURCE_ID is not configured'
      );
      err.code = 'LEGACY_CURSOR_UNMAPPED';
      throw err;
    }
    if (sourceId === legacySourceId) {
      try {
        return await Cursor.findOneAndUpdate(
          { key: scopedKey },
          {
            $setOnInsert: {
              key: scopedKey,
              sourceId,
              lastTimestamp: legacy.lastTimestamp || null,
              lastRowIndex: Number.isInteger(legacy.lastRowIndex) ? legacy.lastRowIndex : null,
              migratedFrom: legacyCursorKey(chamberId),
              migratedAt: new Date(),
              leaseUntil: null,
              leaseOwner: null,
            },
          },
          { upsert: true, new: true }
        );
      } catch (err) {
        if (err.code === 11000) return Cursor.findOne({ key: scopedKey });
        throw err;
      }
    }
  }

  try {
    return await Cursor.findOneAndUpdate(
      { key: scopedKey },
      {
        $setOnInsert: {
          key: scopedKey,
          sourceId,
          lastTimestamp: null,
          lastRowIndex: null,
          leaseUntil: null,
          leaseOwner: null,
        },
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    if (err.code === 11000) return Cursor.findOne({ key: scopedKey });
    throw err;
  }
}

function rowKey(sourceId, rowIndex, chamberId) {
  return `sheet:${sourceId}:${rowIndex}:ch${chamberId}`;
}

function rowFingerprint(head, row, chamberId) {
  return crypto.createHash('sha256').update(JSON.stringify([head, row, chamberId])).digest('hex');
}

function isInvalidSheetTvoc(value) {
  return Number(value) === TVOC_SENTINEL;
}

function isTerminalReceipt(status) {
  return TERMINAL_RECEIPT_STATUSES.has(status);
}

function classifyImportError(err) {
  const code = err && err.details ? err.details.code : null;
  if (code === 'NO_ACTIVE_EXPERIMENT') return { status: 'UNASSIGNED', reason: code };
  if (code === 'MISSING_EXPERIMENT_SESSION' || code === 'CHAMBER_NOT_IN_EXPERIMENT') {
    return { status: 'QUARANTINED_INTEGRITY', reason: code };
  }
  if (err && err.status === 400) return { status: 'QUARANTINED_INVALID', reason: 'INVALID_ROW' };
  return { status: 'RETRYABLE_ERROR', reason: 'RETRYABLE_ERROR' };
}

async function findReceipt(ReceiptModel, key, fingerprint, chamberId, sourceId) {
  const byKey = await ReceiptModel.findOne({ key });
  if (byKey) return byKey;
  if (!fingerprint) return null;
  return ReceiptModel.findOne({ rowFingerprint: fingerprint, chamberId, sourceId });
}

async function recordReceipt(ReceiptModel, fields) {
  const { key, ...rest } = fields;
  const update = { $set: rest };
  if (rest.attempts === undefined) update.$setOnInsert = { attempts: 0 };
  await ReceiptModel.updateOne({ key }, update, { upsert: true });
}

/**
 * Process parsed CSV rows without network access. Exported so importer
 * outcomes can be tested with deterministic fixtures and in-memory models.
 */
async function processRows(csvRows, {
  sourceId = 'default:0',
  mode = env.sheet.mode,
  since = null,
  cutoff = null,
  models = { ImportCursor, ImportReceipt, Chamber },
  ingest = ingestReading,
  alreadyStoredFn = alreadyStored,
  legacySourceId = env.sheet.legacySourceId,
} = {}) {
  const head = csvRows[0] || [];
  const readings = rowsToReadings(csvRows, {
    offset: env.sheet.tzOffset,
    order: env.sheet.dateOrder,
  });
  const maxRowIndex = Math.max(-1, csvRows.length - 2);
  const fallback = mode === 'fallback';
  const counts = {
    imported: 0,
    duplicates: 0,
    rejected: 0,
    unassigned: 0,
    deferred: 0,
    retryExhausted: 0,
    locked: 0,
    cursorErrors: 0,
    cursorErrorCode: null,
    rows: readings.length,
    mode,
  };

  const byRow = new Map();
  for (const r of readings) {
    if (!byRow.has(r.rowIndex)) byRow.set(r.rowIndex, {});
    byRow.get(r.rowIndex)[r.chamberId] = r;
  }

  for (const n of CHAMBERS) {
    const cursorKey = cursorKeyFor(sourceId, n);
    const owner = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    try {
      await ensureCursor(models, sourceId, n, legacySourceId);
    } catch (err) {
      counts.cursorErrors += 1;
      counts.cursorErrorCode = err.code || 'CURSOR_ERROR';
      continue;
    }
    let doc;
    try {
      doc = await models.ImportCursor.findOneAndUpdate(
        {
          key: cursorKey,
          $or: [{ leaseUntil: null }, { leaseUntil: { $lt: new Date() } }],
        },
        { $set: { leaseUntil: new Date(Date.now() + LEASE_MS), leaseOwner: owner } },
        { upsert: true, new: true }
      );
    } catch (err) {
      if (err.code === 11000) {
        counts.locked += 1;
        continue;
      }
      throw err;
    }
    if (!doc || doc.leaseOwner !== owner) {
      counts.locked += 1;
      continue;
    }

    const cursor = {
      last: doc?.lastTimestamp || null,
      row: Number.isInteger(doc?.lastRowIndex) ? doc.lastRowIndex : null,
    };
    const usesRowCursor = cursor.row !== null;
    // A temporarily truncated/failed CSV must not reset the cursor to null and
    // replay history. Clamp to the current end; an intentional sheet
    // replacement requires an explicit operator rewind.
    if (usesRowCursor && cursor.row > maxRowIndex) cursor.row = maxRowIndex;
    let changed = false;

    try {
    for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex += 1) {
      if (rowIndex > 0 && rowIndex % 50 === 0) {
        // Keep the lease alive for large sheets. If another process has taken
        // over, stop instead of double-processing.
        const renewed = await models.ImportCursor.updateOne(
          { key: cursorKey, leaseOwner: owner },
          { $set: { leaseUntil: new Date(Date.now() + LEASE_MS) } }
        );
        if (renewed && renewed.modifiedCount === 0) {
          counts.locked += 1;
          break;
        }
      }
      if (cursor.row !== null && rowIndex <= cursor.row) continue;
      const r = byRow.get(rowIndex)?.[n];
      if (!r) {
        if (usesRowCursor) { cursor.row = rowIndex; changed = true; }
        continue;
      }

      const rawRow = (csvRows[rowIndex + 1] || []).map((v) => String(v ?? ''));
      const fingerprint = rowFingerprint(head, rawRow, n);
      const receiptKey = rowKey(sourceId, rowIndex, n);
      const receipt = await findReceipt(models.ImportReceipt, receiptKey, fingerprint, n, sourceId);

      // A terminal receipt is the durable outcome; a later timestamp parse
      // change must not overwrite an already completed row.
      if (receipt && isTerminalReceipt(receipt.status)) {
        cursor.row = rowIndex;
        changed = true;
        continue;
      }

      if (!r.timestamp) {
        const reason = r.timestampQuality === 'INVALID' ? 'TIMESTAMP_INVALID' : 'TIMESTAMP_MISSING';
        await recordReceipt(models.ImportReceipt, {
          key: receiptKey,
          sourceId,
          rowIndex,
          rowFingerprint: fingerprint,
          chamberId: n,
          sampleId: r.sampleId,
          eventId: r.eventId,
          status: 'QUARANTINED_INVALID',
          reason,
          rawRow,
        });
        counts.rejected += 1;
        cursor.row = rowIndex;
        changed = true;
        continue;
      }
      if (!usesRowCursor && cursor.last && r.sortTime <= cursor.last) {
        cursor.last = r.sortTime;
        changed = true;
        continue;
      }
      if (since && r.timestamp < since) {
        cursor.row = rowIndex;
        changed = true;
        continue;
      }
      // Fallback grace: wait for MQTT first; this is transient, not a terminal
      // outcome, so the cursor stays put.
      if (cutoff && r.timestamp > cutoff) {
        counts.deferred += 1;
        break;
      }
      if (
        receipt &&
        receipt.status === 'RETRYABLE_ERROR' &&
        (receipt.attempts || 0) >= MAX_RETRY_ATTEMPTS
      ) {
        await recordReceipt(models.ImportReceipt, {
          key: receiptKey,
          sourceId,
          rowIndex,
          rowFingerprint: fingerprint,
          chamberId: n,
          status: 'QUARANTINED_RETRY_EXHAUSTED',
          reason: 'MAX_RETRY_ATTEMPTS',
          rawRow,
          attempts: receipt.attempts,
          lastError: receipt.lastError || null,
        });
        counts.retryExhausted += 1;
        cursor.row = rowIndex;
        changed = true;
        continue;
      }

      // Conservative sentinel policy for Sheet data. MQTT validation is not
      // changed here because the data contract has not established that 99999
      // is invalid for every source.
      if (isInvalidSheetTvoc(r.tvoc)) {
        await recordReceipt(models.ImportReceipt, {
          key: receiptKey,
          sourceId,
          rowIndex,
          rowFingerprint: fingerprint,
          chamberId: n,
          sampleId: r.sampleId,
          eventId: r.eventId,
          status: 'QUARANTINED_INVALID',
          reason: 'INVALID_TVOC_SENTINEL',
          rawRow,
        });
        counts.rejected += 1;
        cursor.row = rowIndex;
        changed = true;
        continue;
      }

      if (r.sampleIdInvalid) {
        await recordReceipt(models.ImportReceipt, {
          key: receiptKey,
          sourceId,
          rowIndex,
          rowFingerprint: fingerprint,
          chamberId: n,
          status: 'QUARANTINED_INVALID',
          reason: 'INVALID_SAMPLE_ID',
          rawRow,
        });
        counts.rejected += 1;
        cursor.row = rowIndex;
        changed = true;
        continue;
      }

      if (!r.eventId && (await alreadyStoredFn(n, r.timestamp, env.sheet.matchSec))) {
        await recordReceipt(models.ImportReceipt, {
          key: receiptKey,
          sourceId,
          rowIndex,
          rowFingerprint: fingerprint,
          chamberId: n,
          status: 'DUPLICATE',
          reason: 'LEGACY_TIME_MATCH',
          rawRow,
        });
        counts.duplicates += 1;
        cursor.last = r.sortTime;
        cursor.row = rowIndex;
        changed = true;
        continue;
      }

      try {
        // Pass the resolved measurement time for both sampled_at and the
        // validated sample_id fallback. Legacy rows keep their historical
        // receipt-time behavior and pass no measurement timestamp.
        const measurementIso =
          (r.timestampSource === 'sampled' || r.timestampSource === 'sample_id') && r.timestamp
            ? r.timestamp.toISOString()
            : undefined;
        const result = await ingest(
          {
            chamber_id: n,
            sample_id: r.sampleId || undefined,
            sampled_at: measurementIso,
            tvoc: r.tvoc,
            suhu: r.suhu,
            rh: r.rh,
            battery: r.battery,
          },
          {
            receivedAt: r.receivedAtHasTime ? r.receivedAt : new Date(),
            source: 'sheet',
            timestampSource: r.timestampSource,
            timestampQuality: r.timestampQuality,
          }
        );
        const status = result.duplicate ? 'DUPLICATE' : 'IMPORTED';
        await recordReceipt(models.ImportReceipt, {
          key: receiptKey,
          sourceId,
          rowIndex,
          rowFingerprint: fingerprint,
          chamberId: n,
          sampleId: r.sampleId,
          eventId: r.eventId,
          experimentId: result.session?.experimentId || null,
          status,
          reason: result.duplicate ? 'DUPLICATE_EVENT' : null,
          rawRow,
        });
        if (result.duplicate) counts.duplicates += 1;
        else counts.imported += 1;
        cursor.last = r.sortTime;
        cursor.row = rowIndex;
        changed = true;
      } catch (err) {
        const outcome = classifyImportError(err);
        const attempts = (receipt?.attempts || 0) + 1;
        if (outcome.status === 'RETRYABLE_ERROR') {
          if (attempts >= MAX_RETRY_ATTEMPTS) {
            await recordReceipt(models.ImportReceipt, {
              key: receiptKey,
              sourceId,
              rowIndex,
              rowFingerprint: fingerprint,
              chamberId: n,
              status: 'QUARANTINED_RETRY_EXHAUSTED',
              reason: outcome.reason,
              rawRow,
              attempts,
              lastError: err.message,
            });
            counts.retryExhausted += 1;
            cursor.row = rowIndex;
            changed = true;
          } else {
            await recordReceipt(models.ImportReceipt, {
              key: receiptKey,
              sourceId,
              rowIndex,
              rowFingerprint: fingerprint,
              chamberId: n,
              status: 'RETRYABLE_ERROR',
              reason: outcome.reason,
              rawRow,
              attempts,
              lastError: err.message,
            });
            // Do not advance: the row is retried on the next poll.
            break;
          }
        } else {
          await recordReceipt(models.ImportReceipt, {
            key: receiptKey,
            sourceId,
            rowIndex,
            rowFingerprint: fingerprint,
            chamberId: n,
            sampleId: r.sampleId,
            eventId: r.eventId,
            status: outcome.status,
            reason: outcome.reason,
            rawRow,
            attempts,
            lastError: err.message,
          });
          if (outcome.status === 'UNASSIGNED') counts.unassigned += 1;
          else counts.rejected += 1;
          cursor.row = rowIndex;
          changed = true;
        }
      }
    }

    if (changed) {
      await models.ImportCursor.updateOne(
        { key: cursorKey },
        { $set: { lastTimestamp: cursor.last, lastRowIndex: cursor.row } },
        { upsert: true }
      );
    }
    } finally {
      await models.ImportCursor.updateOne(
        { key: cursorKey, leaseOwner: owner },
        { $set: { leaseUntil: null, leaseOwner: null } }
      );
    }
  }

  // Battery: use the newest row that carries vbat, even if the row was already
  // imported or quarantined.
  for (const n of CHAMBERS) {
    const withBat = readings.filter((r) => r.chamberId === n && r.battery !== null);
    const latest = withBat[withBat.length - 1];
    if (!latest) continue;
    await models.Chamber.updateOne(
      { chamberId: n, $or: [{ batteryAt: null }, { batteryAt: { $lt: latest.timestamp } }] },
      { $set: { battery: latest.battery, batteryAt: latest.timestamp } }
    );
  }

  return counts;
}

async function syncOnce() {
  const url = toCsvUrl(env.sheet.url);
  const res = await fetch(url, { redirect: 'follow' });
  const text = await res.text();
  if (!res.ok || /^\s*<(!doctype|html)/i.test(text)) {
    throw new Error(
      `Sheet tidak bisa dibaca (HTTP ${res.status}). Pastikan Sheet dibagikan "Anyone with the link: Viewer" ` +
        'atau dipublikasikan sebagai CSV (File > Share > Publish to web).'
    );
  }
  const csvRows = parseCsv(text);
  const since = env.sheet.importSince ? new Date(env.sheet.importSince) : null;
  const fallback = env.sheet.mode === 'fallback';
  const cutoff = fallback ? new Date(Date.now() - env.sheet.graceSec * 1000) : null;
  return processRows(csvRows, {
    sourceId: sourceIdFromUrl(env.sheet.url),
    mode: env.sheet.mode,
    since,
    cutoff,
    legacySourceId: env.sheet.legacySourceId,
  });
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const r = await syncOnce();
    lastStatus = { enabled: true, ok: true, at: new Date(), ...r };
    if (r.imported) console.log(`[sheet] ${r.imported} data baru diimpor dari Google Sheet`);
    if (r.duplicates) console.log(`[sheet] ${r.duplicates} baris sudah ada (MQTT/import lain), dilewati`);
    if (r.cursorErrors) {
      console.error(
        `[sheet] cursor tidak dapat dipakai untuk ${r.cursorErrors} chamber: ${r.cursorErrorCode}`
      );
    }
  } catch (err) {
    lastStatus = { enabled: true, ok: false, at: new Date(), error: err.message };
    console.error(`[sheet] ${err.message}`);
  } finally {
    running = false;
  }
}

function start() {
  if (!env.sheet.url) return;
  if (!hasExplicitGid(env.sheet.url)) {
    console.warn(
      '[sheet] SHEET_URL tidak menyertakan gid; Google mengekspor tab pertama. ' +
        'Tambahkan gid=<tab testing> agar importer tidak membaca tab sesi historis.'
    );
  }
  console.log(
    env.sheet.mode === 'fallback'
      ? `[sheet] mode CADANGAN: tiap ${env.sheet.pollSec} detik, baris Sheet hanya diimpor bila belum ada`
      : `[sheet] membaca Google Sheet tiap ${env.sheet.pollSec} detik`
  );
  tick();
  timer = setInterval(tick, env.sheet.pollSec * 1000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

const status = () => lastStatus;

module.exports = {
  start, stop, status, syncOnce, processRows, parseCsv, toCsvUrl, toNumber, parseTimestamp,
  rowsToReadings, selectFresh, hasExplicitGid, parseIsoTimestamp, extractSampleIdTimestamp,
  sourceIdFromUrl, cursorKeyFor, legacyCursorKey, ensureCursor, rowKey, rowFingerprint, isInvalidSheetTvoc,
  classifyImportError, isTerminalReceipt, MAX_RETRY_ATTEMPTS,
};
