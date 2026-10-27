/** Aturan baterai alat sensor. */
const LOW_PERCENT = 20; // di bawah ini: Lemah (merah) + notifikasi
const MID_PERCENT = 50; // 20-50: Sedang (kuning), di atas 50: Baik (hijau)
const RESET_PERCENT = 30; // peringatan boleh dikirim lagi setelah baterai diisi melewati angka ini

function batteryLevel(pct) {
  if (pct === null || pct === undefined) return null;
  if (pct < LOW_PERCENT) return 'lemah';
  if (pct <= MID_PERCENT) return 'sedang';
  return 'baik';
}

/** Ubah nilai mentah (angka/teks, boleh "72%") menjadi 0-100, atau null bila tidak ada/tidak valid. */
function parseBattery(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace('%', '').replace(',', '.').trim());
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(100, Math.max(0, n)));
}

module.exports = { LOW_PERCENT, MID_PERCENT, RESET_PERCENT, batteryLevel, parseBattery };
