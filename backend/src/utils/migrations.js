const Session = require('../models/Session');
const SensorReading = require('../models/SensorReading');

/** Label status lama (sebelum diganti ke "Konsumsi") -> label baru. */
const STATUS_RENAMES = {
  'Layak Jual': 'Layak Konsumsi',
  'Segera Jual': 'Segera Konsumsi',
  'Tidak Layak Jual': 'Tidak Layak Konsumsi',
};

/**
 * Laporkan (jangan hapus) pembacaan lama yang berbagi chamber + timestamp yang
 * sama. Baris lama tanpa eventId tidak terkena unique index baru, tetapi
 * duplikat historis tetap perlu diketahui sebelum analisis.
 */
async function reportHistoricalDuplicates() {
  const duplicates = await SensorReading.aggregate([
    { $match: { eventId: null } },
    { $group: { _id: { chamberId: '$chamberId', timestamp: '$timestamp' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $count: 'groups' },
  ]);
  const groups = duplicates[0]?.groups || 0;
  if (groups) {
    console.warn(
      `[migrasi] ${groups} grup (chamber+timestamp) berisi >1 pembacaan lama tanpa eventId. ` +
        'Tidak dihapus otomatis; tinjau sebelum analisis.'
    );
  }
  return groups;
}

/** Dijalankan saat backend menyala; aman diulang (tidak mengubah data historis). */
async function runMigrations() {
  let changed = 0;
  for (const [from, to] of Object.entries(STATUS_RENAMES)) {
    const r = await Session.updateMany({ statusAkhir: from }, { $set: { statusAkhir: to } });
    changed += r.modifiedCount || 0;
  }
  if (changed) console.log(`[migrasi] ${changed} sesi memakai label status baru (Konsumsi)`);
  await reportHistoricalDuplicates();
}

module.exports = { runMigrations, reportHistoricalDuplicates, STATUS_RENAMES };
