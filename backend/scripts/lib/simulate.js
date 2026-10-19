/**
 * Pembangkit data sensor SINTETIS untuk seed & simulator.
 * Ini hanya untuk demo/uji aplikasi. Bentuk kurva TVOC di sini adalah asumsi,
 * bukan hasil pengukuran. Korelasi TVOC-bakteri pada tahu belum tervalidasi.
 */
const { baseTslHours } = require('../../src/utils/mlMock');

/** PRNG deterministik agar seed selalu menghasilkan data yang sama. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (rnd) => {
  const u = Math.max(rnd(), 1e-9);
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** TVOC (ppb) naik makin cepat saat umur mendekati Tsl. */
function tvocAt(ageHours, tslHours) {
  const frac = Math.max(0, Math.min(ageHours / tslHours, 1.3));
  return 120 + 700 * Math.pow(frac, 1.6);
}

/**
 * Bangun satu sesi sintetis.
 * @returns {{readings: object[], predictions: object[], tsl: number}}
 */
function buildSession({ rnd, chamberId, start, ageHours, stepMinutes, tempC, rhBase, tsl }) {
  const readings = [];
  const predictions = [];
  const steps = Math.max(1, Math.floor((ageHours * 60) / stepMinutes));
  for (let i = 0; i <= steps; i += 1) {
    const age = (i * stepMinutes) / 60;
    const ts = new Date(start.getTime() + i * stepMinutes * 60000);
    const last = i === steps;
    const noise = last ? 0 : 1;
    const tvoc = Math.max(20, tvocAt(age, tsl) + noise * gauss(rnd) * 12);
    const suhu = tempC + noise * gauss(rnd) * 0.25;
    const rh = Math.min(99, Math.max(30, rhBase + noise * gauss(rnd) * 1.2));
    readings.push({
      chamberId, tvoc: round(tvoc, 1), suhu: round(suhu, 2), rh: round(rh, 1), timestamp: ts,
    });
    const remaining = Math.max(0.05, tsl - age);
    const pred = last ? remaining : remaining * (1 + gauss(rnd) * 0.04);
    predictions.push({
      chamberId,
      tvoc_snapshot: round(tvoc, 1),
      suhu_snapshot: round(suhu, 2),
      rh_snapshot: round(rh, 1),
      shelfLifeJam: round(Math.max(0.05, pred), 2),
      // Seed meniru state machine: RF di 90 menit pertama, lalu LSTM (hanya data demo).
      modelUsed: age < 1.5 ? 'random_forest' : 'lstm',
      prediksiDibuat: ts,
    });
  }
  return { readings, predictions, tsl };
}

const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

module.exports = { mulberry32, gauss, tvocAt, buildSession, baseTslHours, round };
