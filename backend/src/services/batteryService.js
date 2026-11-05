const SensorReading = require('../models/SensorReading');
const { batteryLevel } = require('../utils/battery');
const { isConnected } = require('../utils/presenters');

const CHAMBERS = [1, 2];

/**
 * Baterai alat = nilai pada DATA SENSOR TERAKHIR (chamber mana pun), apa adanya:
 *  - data terakhir tanpa baterai (vbat kosong) -> percent null (tampil "–")
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
  if (!r) return { percent: null, level: null, at: null, stale: false, noData: true };
  const percent = r.battery === null || r.battery === undefined ? null : r.battery;
  return {
    percent,
    level: percent === null ? null : batteryLevel(percent),
    at: r.timestamp,
    stale: !isConnected({ lastSeenAt: r.timestamp }, settings, now),
    noData: false,
  };
}

module.exports = { latestBattery };
