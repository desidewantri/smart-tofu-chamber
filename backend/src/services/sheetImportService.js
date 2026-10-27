/**
 * Impor data sensor dari Google Sheet (CSV) ke aplikasi.
 *
 * Format Sheet yang didukung (baris 1 = judul kolom, huruf besar/kecil bebas):
 *   timestamp | temp1 | humid1 | tvoc1 | temp2 | humid2 | tvoc2 | ...kolom lain diabaikan
 * Kolom berakhiran 1 -> Chamber 1, berakhiran 2 -> Chamber 2.
 *
 * Setiap SHEET_POLL_SEC detik, backend mengunduh CSV dan hanya memasukkan baris yang lebih baru
 * dari baris terakhir yang sudah diimpor (disimpan di koleksi importcursors).
 */
const env = require('../config/env');
const ImportCursor = require('../models/ImportCursor');
const Chamber = require('../models/Chamber');
const { ingestReading } = require('./ingestService');
const { parseBattery } = require('../utils/battery');

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

/** Ubah isi CSV menjadi daftar pembacaan { chamberId, timestamp, tvoc, suhu, rh }. */
function rowsToReadings(rows, opts = {}) {
  if (!rows.length) return [];
  const head = rows[0].map((h) => String(h).trim().toLowerCase());
  const col = (names) => head.findIndex((h) => names.includes(h));
  const tsIdx = col(['timestamp', 'waktu', 'time', 'tanggal']);
  if (tsIdx < 0) throw new Error('Kolom "timestamp" tidak ditemukan di baris pertama Sheet');
  const map = CHAMBERS.map((n) => ({
    chamberId: n,
    suhu: col([`temp${n}`, `suhu${n}`, `temperature${n}`]),
    rh: col([`humid${n}`, `rh${n}`, `humidity${n}`, `kelembapan${n}`]),
    tvoc: col([`tvoc${n}`]),
    // Baterai: kolom per chamber (battery1) atau satu kolom untuk alat (battery / baterai).
    battery: (() => {
      const own = col([`battery${n}`, `baterai${n}`, `bat${n}`, `vbat${n}`]);
      return own >= 0 ? own : col(['vbat', 'battery', 'baterai', 'bat', 'batt', 'battery (%)', 'baterai (%)', 'v_bat']);
    })(),
  })).filter((c) => c.suhu >= 0 && c.rh >= 0 && c.tvoc >= 0);
  if (!map.length) throw new Error('Kolom temp1/humid1/tvoc1 (atau temp2/humid2/tvoc2) tidak ditemukan');

  const out = [];
  for (const r of rows.slice(1)) {
    const timestamp = parseTimestamp(r[tsIdx], opts);
    if (!timestamp) continue; // baris kosong / catatan
    for (const c of map) {
      const tvoc = toNumber(r[c.tvoc]);
      const suhu = toNumber(r[c.suhu]);
      const rh = toNumber(r[c.rh]);
      if ([tvoc, suhu, rh].some((x) => !Number.isFinite(x))) continue;
      const battery = c.battery >= 0 ? parseBattery(r[c.battery]) : null;
      out.push({ chamberId: c.chamberId, timestamp, tvoc, suhu, rh, battery });
    }
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
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
  const readings = rowsToReadings(parseCsv(text), { offset: env.sheet.tzOffset, order: env.sheet.dateOrder });

  const since = env.sheet.importSince ? new Date(env.sheet.importSince) : null;
  let imported = 0;
  for (const n of CHAMBERS) {
    const key = `sheet:${n}`;
    const cursor = await ImportCursor.findOne({ key });
    let last = cursor?.lastTimestamp || null;
    const fresh = readings.filter(
      (r) => r.chamberId === n && (!last || r.timestamp > last) && (!since || r.timestamp >= since)
    );
    for (const r of fresh) {
      try {
        await ingestReading(
          { chamber_id: n, tvoc: r.tvoc, suhu: r.suhu, rh: r.rh, battery: r.battery, timestamp: r.timestamp.toISOString() },
          { seenAt: r.timestamp }
        );
        imported += 1;
      } catch (err) {
        console.error(`[sheet] baris ${r.timestamp.toISOString()} chamber ${n} dilewati: ${err.message}`);
      }
      last = r.timestamp;
    }
    if (fresh.length) {
      await ImportCursor.updateOne({ key }, { $set: { lastTimestamp: last } }, { upsert: true });
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
  return { imported, rows: readings.length };
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const r = await syncOnce();
    lastStatus = { enabled: true, ok: true, at: new Date(), ...r };
    if (r.imported) console.log(`[sheet] ${r.imported} data baru diimpor dari Google Sheet`);
  } catch (err) {
    lastStatus = { enabled: true, ok: false, at: new Date(), error: err.message };
    console.error(`[sheet] ${err.message}`);
  } finally {
    running = false;
  }
}

function start() {
  if (!env.sheet.url) return;
  console.log(`[sheet] membaca Google Sheet tiap ${env.sheet.pollSec} detik`);
  tick();
  timer = setInterval(tick, env.sheet.pollSec * 1000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

const status = () => lastStatus;

module.exports = { start, stop, status, syncOnce, parseCsv, toCsvUrl, toNumber, parseTimestamp, rowsToReadings };
