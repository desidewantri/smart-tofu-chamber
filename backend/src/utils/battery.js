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

/**
 * Tegangan baterai Li-ion 1 sel (V) -> perkiraan persen (kurva pengosongan umum, 3,27 V = 0%, 4,20 V = 100%).
 * Perkiraan kasar: tegangan juga dipengaruhi beban, jadi angka bisa naik-turun sedikit.
 */
const VOLT_CURVE = [
  [3.27, 0], [3.61, 5], [3.69, 10], [3.71, 15], [3.73, 20], [3.75, 25], [3.77, 30], [3.79, 35],
  [3.8, 40], [3.82, 45], [3.84, 50], [3.85, 55], [3.87, 60], [3.91, 65], [3.95, 70], [3.98, 75],
  [4.02, 80], [4.08, 85], [4.11, 90], [4.15, 95], [4.2, 100],
];
function voltsToPercent(v) {
  if (v <= VOLT_CURVE[0][0]) return 0;
  if (v >= VOLT_CURVE[VOLT_CURVE.length - 1][0]) return 100;
  for (let i = 1; i < VOLT_CURVE.length; i += 1) {
    const [v2, p2] = VOLT_CURVE[i];
    if (v <= v2) {
      const [v1, p1] = VOLT_CURVE[i - 1];
      return p1 + ((v - v1) * (p2 - p1)) / (v2 - v1);
    }
  }
  return 100;
}

/**
 * Ubah nilai mentah menjadi persen 0-100, atau null bila kosong/tidak valid.
 * - 0 < nilai <= 5   : dianggap tegangan (V), mis. vbat 3,94 -> ±69%
 * - 5 < nilai <= 100 : dianggap persen, mis. 76,47 -> 76%
 */
function parseBattery(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace('%', '').replace(/v$/i, '').replace(',', '.').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  if (n > 0 && n <= 5) return Math.round(voltsToPercent(n));
  return Math.round(Math.min(100, n));
}

module.exports = { LOW_PERCENT, MID_PERCENT, RESET_PERCENT, batteryLevel, parseBattery, voltsToPercent };
