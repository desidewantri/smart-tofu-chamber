const SensorReading = require('../models/SensorReading');
const { batteryLevel, parseBattery } = require('../utils/battery');
const { isConnected } = require('../utils/presenters');

const CHAMBERS = [1, 2];
const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1X-Bh7UX4f1-jNK76X96lixMFh-WrRmQS8dUs5SWMvNA/export?format=csv&gid=1822230910';

let cachedSheetBat = null;
let lastSheetFetch = 0;

async function getSheetBattery() {
  const now = Date.now();
  if (cachedSheetBat && now - lastSheetFetch < 30000) {
    return cachedSheetBat;
  }
  try {
    const res = await fetch(SHEET_CSV_URL, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return cachedSheetBat;
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length > 1) {
      const lastLine = lines[lines.length - 1];
      const parts = lastLine.split(',');
      const rawVbat = parts[parts.length - 1]?.trim();
      const pct = parseBattery(rawVbat);
      const ts = parts[2] ? new Date(parts[2].trim()) : new Date();
      if (pct !== null) {
        cachedSheetBat = { percent: pct, timestamp: ts };
        lastSheetFetch = now;
      }
    }
  } catch (_) {
    // fallback gracefully
  }
  return cachedSheetBat;
}

/**
 * Baterai alat = nilai pada DATA SENSOR TERAKHIR (chamber mana pun), apa adanya:
 *  - data terakhir tanpa baterai (vbat kosong) -> fallback ambil dari Sheet CSV
 *  - baterai 0 -> 0, selain itu sesuai nilainya
 * stale = data terakhir lebih lama dari 3 x interval (alat tidak mengirim data).
 * noData = belum pernah ada data sensor sama sekali.
 */
async function latestBattery(settings, now = Date.now()) {
  // Satu query per chamber agar memakai index { chamberId, timestamp }.
  const latest = await Promise.all(
    CHAMBERS.map((chamberId) =>
      SensorReading.findOne({ chamberId }).sort({ timestamp: -1 }).select('battery timestamp').lean()
    )
  );
  const r = latest.filter(Boolean).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  let percent = r && r.battery !== null && r.battery !== undefined ? r.battery : null;
  let timestamp = r ? r.timestamp : null;

  if (percent === null) {
    const sheetBat = await getSheetBattery();
    if (sheetBat && sheetBat.percent !== null) {
      percent = sheetBat.percent;
      timestamp = sheetBat.timestamp || timestamp;
    }
  }

  if (percent === null && !r) return { percent: null, level: null, at: null, stale: false, noData: true };
  return {
    percent,
    level: percent === null ? null : batteryLevel(percent),
    at: timestamp,
    stale: timestamp ? !isConnected({ lastSeenAt: timestamp }, settings, now) : false,
    noData: percent === null && !timestamp,
  };
}

module.exports = { latestBattery };
