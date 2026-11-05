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
const ImportCursor = require('../models/ImportCursor');
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
function rowsToReadings(rows, opts = {}) {
  if (!rows.length) return [];
  const head = rows[0].map((h) => String(h).trim().toLowerCase());
  const col = (names) => head.findIndex((h) => names.includes(h));

  const sampledIdx = col(['sampled_at', 'sampledat', 'waktu_sampel']);
  const tsIdx = col(['timestamp', 'waktu', 'time', 'tanggal']);
  const receivedIdx = col(['received_at', 'receivedat', 'diterima']);
  const sampleIdx = col(['sample_id', 'sampleid', 'id_sampel']);

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
    const sampledAt = sampledIdx >= 0 ? parseTimestamp(r[sampledIdx], opts) : null;
    const explicitReceivedAt = receivedIdx >= 0 ? parseTimestamp(r[receivedIdx], opts) : null;
    // Skema lama: Apps Script menulis `timestamp` dengan new Date() saat request
    // diterima. Itu waktu terima, bukan waktu sampel.
    const legacyReceivedAt = tsIdx >= 0 ? parseTimestamp(r[tsIdx], opts) : null;
    const receivedAt = explicitReceivedAt || legacyReceivedAt;
    const timestamp = sampledAt || receivedAt;
    if (!timestamp) return; // baris kosong / catatan

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
        receivedAt: receivedAt || null,
        timestamp,
        timestampQuality: sampledAt ? 'OK' : 'MISSING',
        eventId: sampleId ? deriveEventId(sampleId, c.chamberId) : null,
        sortTime: receivedAt || timestamp,
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
  const readings = rowsToReadings(csvRows, { offset: env.sheet.tzOffset, order: env.sheet.dateOrder });
  const maxRowIndex = Math.max(-1, csvRows.length - 2); // index baris data terakhir

  const since = env.sheet.importSince ? new Date(env.sheet.importSince) : null;
  const fallback = env.sheet.mode === 'fallback';
  const cutoff = fallback ? new Date(Date.now() - env.sheet.graceSec * 1000) : null;
  let imported = 0;
  let duplicates = 0;
  let rejected = 0;
  let deferred = 0;

  const byRow = new Map();
  for (const r of readings) {
    if (!byRow.has(r.rowIndex)) byRow.set(r.rowIndex, {});
    byRow.get(r.rowIndex)[r.chamberId] = r;
  }

  for (const n of CHAMBERS) {
    const key = `sheet:${n}`;
    const doc = await ImportCursor.findOne({ key });
    const cursor = {
      last: doc?.lastTimestamp || null,
      row: Number.isInteger(doc?.lastRowIndex) ? doc.lastRowIndex : null,
    };
    const usesRowCursor = cursor.row !== null;
    // Sheet dipendekkan / diganti: mulai dari awal, dedup DB yang menjaga.
    if (usesRowCursor && cursor.row > maxRowIndex) cursor.row = null;
    let changed = false;

    for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex += 1) {
      if (cursor.row !== null && rowIndex <= cursor.row) continue;
      const r = byRow.get(rowIndex)?.[n];
      if (!r) {
        // Baris tanpa data untuk chamber ini: dengan cursor baris, lewati permanen.
        if (usesRowCursor) { cursor.row = rowIndex; changed = true; }
        continue;
      }
      // Cursor lama berbasis waktu (sekali, sebelum cursor baris terbentuk).
      if (!usesRowCursor && cursor.last && r.sortTime <= cursor.last) {
        cursor.last = r.sortTime;
        changed = true;
        continue;
      }
      if (since && r.timestamp < since) {
        cursor.row = rowIndex; changed = true; continue;
      }
      // Mode cadangan: tunda baris yang masih baru agar MQTT datang lebih dulu.
      if (cutoff && r.timestamp > cutoff) { deferred += 1; break; }
      if (r.sampleIdInvalid) {
        rejected += 1;
        console.error(`[sheet] sample_id tidak valid "${r.sampleIdInvalid}" (baris ${rowIndex + 2})`);
        cursor.row = rowIndex; changed = true; continue;
      }
      // Baris lama tanpa identitas: pertahankan pemeriksaan kedekatan waktu.
      if (fallback && !r.eventId && (await alreadyStored(n, r.timestamp, env.sheet.matchSec))) {
        duplicates += 1;
        cursor.last = r.sortTime; cursor.row = rowIndex; changed = true; continue;
      }
      try {
        const result = await ingestReading(
          {
            chamber_id: n,
            sample_id: r.sampleId || undefined,
            // Only a real sample time is sent as sampled_at. A row that only has
            // received_at stays flagged MISSING in the backend.
            sampled_at: r.sampledAt ? r.sampledAt.toISOString() : undefined,
            tvoc: r.tvoc,
            suhu: r.suhu,
            rh: r.rh,
            battery: r.battery,
          },
          // Jangan pernah memakai waktu sampel sebagai waktu terima. Bila Sheet
          // tidak punya received_at, waktu impor adalah proksi terima yang jujur.
          { receivedAt: r.receivedAt || new Date(), source: 'sheet' }
        );
        if (result.duplicate) duplicates += 1;
        else imported += 1;
        cursor.last = r.sortTime;
        cursor.row = rowIndex;
        changed = true;
      } catch (err) {
        rejected += 1;
        console.error(`[sheet] baris ${r.timestamp.toISOString()} chamber ${n} dilewati: ${err.message}`);
        if (err.status === 400) {
          // Baris tidak valid secara permanen: lewati agar tidak memblokir baris berikutnya.
          cursor.row = rowIndex;
          changed = true;
          continue;
        }
        // Galat sementara (DB/jaringan): jangan majukan cursor, coba lagi poll berikutnya.
        break;
      }
    }
    if (changed) {
      await ImportCursor.updateOne(
        { key },
        { $set: { lastTimestamp: cursor.last, lastRowIndex: cursor.row } },
        { upsert: true }
      );
    }
  }

  // Baterai: pakai baris terbaru yang berisi nilai baterai, walau baris itu sudah pernah diimpor
  // (mis. kolom vbat baru ditambahkan) atau datanya ditolak (mis. TVOC 99999).
  for (const n of CHAMBERS) {
    const withBat = readings.filter((r) => r.chamberId === n && r.battery !== null);
    const latest = withBat[withBat.length - 1];
    if (!latest) continue;
    await Chamber.updateOne(
      { chamberId: n, $or: [{ batteryAt: null }, { batteryAt: { $lt: latest.timestamp } }] },
      { $set: { battery: latest.battery, batteryAt: latest.timestamp } }
    );
  }
  return { imported, duplicates, rejected, deferred, rows: readings.length, mode: env.sheet.mode };
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const r = await syncOnce();
    lastStatus = { enabled: true, ok: true, at: new Date(), ...r };
    if (r.imported) console.log(`[sheet] ${r.imported} data baru diimpor dari Google Sheet`);
    if (r.duplicates) console.log(`[sheet] ${r.duplicates} baris sudah ada (MQTT/import lain), dilewati`);
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
  start, stop, status, syncOnce, parseCsv, toCsvUrl, toNumber, parseTimestamp,
  rowsToReadings, selectFresh, hasExplicitGid,
};
