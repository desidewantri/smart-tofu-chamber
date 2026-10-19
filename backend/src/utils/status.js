const DEFAULT_ZONES = { segarHours: 24, rawanHours: 8 };

const STATUS = {
  LAYAK: 'Layak Jual',
  SEGERA: 'Segera Jual',
  TIDAK: 'Tidak Layak Jual',
};

/** Zona status dari sisa shelf-life (jam): >24 Layak, 8-24 Segera, <8 Tidak Layak. */
function classifyShelfLife(hours, zones = DEFAULT_ZONES) {
  if (hours === null || hours === undefined || Number.isNaN(Number(hours))) return null;
  const h = Number(hours);
  if (h > zones.segarHours) return STATUS.LAYAK;
  if (h >= zones.rawanHours) return STATUS.SEGERA;
  return STATUS.TIDAK;
}

/** Zona sebuah parameter sensor: Aman / Perhatian / Bahaya. */
function classifyParam(value, limits) {
  if (value === null || value === undefined || !limits) return null;
  if (value <= limits.aman) return 'Aman';
  if (value <= limits.perhatian) return 'Perhatian';
  return 'Bahaya';
}

/**
 * Sisa waktu (detik) = T_sl*3600 - (sekarang - t0). Tetap berjalan setelah sesi ditutup
 * (sesuai proposal), dan tidak pernah negatif.
 */
function remainingSeconds(session, now = Date.now()) {
  if (!session || session.shelfLifeAwal === null || session.shelfLifeAwal === undefined) return null;
  if (!session.prediksiDibuat) return null;
  const elapsed = (now - new Date(session.prediksiDibuat).getTime()) / 1000;
  return Math.max(0, Math.round(session.shelfLifeAwal * 3600 - elapsed));
}

module.exports = { DEFAULT_ZONES, STATUS, classifyShelfLife, classifyParam, remainingSeconds };
