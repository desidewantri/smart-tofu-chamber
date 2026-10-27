const Session = require('../models/Session');

/** Label status lama (sebelum diganti ke "Konsumsi") -> label baru. */
const STATUS_RENAMES = {
  'Layak Jual': 'Layak Konsumsi',
  'Segera Jual': 'Segera Konsumsi',
  'Tidak Layak Jual': 'Tidak Layak Konsumsi',
};

/** Dijalankan saat backend menyala; aman diulang (tidak mengubah apa pun bila sudah baru). */
async function runMigrations() {
  let changed = 0;
  for (const [from, to] of Object.entries(STATUS_RENAMES)) {
    const r = await Session.updateMany({ statusAkhir: from }, { $set: { statusAkhir: to } });
    changed += r.modifiedCount || 0;
  }
  if (changed) console.log(`[migrasi] ${changed} sesi memakai label status baru (Konsumsi)`);
}

module.exports = { runMigrations, STATUS_RENAMES };
