/**
 * Model tiruan (MOCK) untuk shelf-life tahu. BUKAN model ML asli.
 * Dipakai selama ml-service (FastAPI) belum terhubung, agar seluruh alur aplikasi bisa dites.
 *
 * Dasar: Tsl (waktu hingga 10^7 CFU/g) per suhu dari literatur yang dikutip proposal:
 *   4°C 141 jam, 10°C 72, 20°C 24, 25°C 14, 30°C 8   (interpolasi di skala log)
 * Lalu dikoreksi ke bawah oleh TVOC yang tinggi dan RH yang tinggi.
 */
const TSL_TABLE = [
  [4, 141],
  [10, 72],
  [20, 24],
  [25, 14],
  [30, 8],
];

function baseTslHours(tempC) {
  const pts = TSL_TABLE.map(([t, h]) => [t, Math.log(h)]);
  let i = 0;
  if (tempC <= pts[0][0]) i = 0;
  else if (tempC >= pts[pts.length - 1][0]) i = pts.length - 2;
  else while (i < pts.length - 2 && tempC > pts[i + 1][0]) i += 1;
  const [t1, y1] = pts[i];
  const [t2, y2] = pts[i + 1];
  const y = y1 + ((tempC - t1) * (y2 - y1)) / (t2 - t1);
  return Math.min(300, Math.max(1, Math.exp(y)));
}

function predictMock({ tvoc, suhu, rh }) {
  const base = baseTslHours(suhu);
  const tvocFactor = Math.exp(-Math.max(0, tvoc - 150) / 700);
  const rhFactor = Math.min(1.1, Math.max(0.6, 1 - 0.004 * (rh - 70)));
  const hours = Math.max(0, base * tvocFactor * rhFactor);
  return { shelfLifeJam: Math.round(hours * 100) / 100, modelUsed: 'mock' };
}

module.exports = { TSL_TABLE, baseTslHours, predictMock };
