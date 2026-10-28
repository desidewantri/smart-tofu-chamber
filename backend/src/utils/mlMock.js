/**
 * Model tiruan (MOCK) untuk shelf-life tahu. BUKAN model ML asli.
 * Tabel literatur di bawah hanya dipakai simulator/seed; prediksi memakai model terkalibrasi (predictMock).
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

/*
 * ===== Model mock terkalibrasi dataset tahu (Sesi 1-3, Oktober 2026) =====
 * Masih model sementara (bukan ML final dari ml-service), tetapi parameternya diambil dari data uji:
 *  - Umur simpan dasar pada 30 °C ±32 jam (Sesi 3: dinyatakan "Tidak layak" pada jam ke-32),
 *    dikoreksi suhu dengan Q10 = 3 (Sesi 1 pada ±32 °C rusak lebih cepat, Sesi 2 pada ±29 °C lebih lambat).
 *  - TVOC mentah AGS10 tidak bisa dipakai langsung (nilai awal tiap sensor berbeda, turun saat pemanasan),
 *    jadi yang dipakai adalah RASIO terhadap nilai terendah sesi (baseline).
 *  - Rasio >= 5 = tanda awal pembusukan (onset). Rasio >= 60 = tidak layak. Dari onset ke tidak layak ±6 jam.
 * Keluaran: perkiraan jam tersisa sampai tahu TIDAK LAYAK konsumsi.
 */
const PARAMS = {
  T30: 32, // jam sampai tidak layak pada 30 °C
  Q10: 3, // faktor percepatan per kenaikan 10 °C
  WARMUP_H: 4, // jam awal: sensor masih pemanasan, TVOC diabaikan
  R_ONSET: 5,
  R_SPOIL: 60,
  ONSET_TO_SPOIL_H: 6,
  MIN_BASE: 50, // ppb, batas bawah baseline agar rasio tidak meledak di nilai sangat kecil
  SLOPE_WINDOW_H: 1.5,
};

function expectedLifeHours(tempC, p = PARAMS) {
  const t = Number.isFinite(tempC) ? tempC : 30;
  return p.T30 * p.Q10 ** ((30 - t) / 10);
}

/** Kemiringan ln(TVOC) per jam dari titik-titik { hours, tvoc } (regresi linear). */
function logSlope(points) {
  const pts = points.filter((x) => Number.isFinite(x.tvoc) && x.tvoc > 0);
  if (pts.length < 6) return null;
  const xs = pts.map((x) => x.hours);
  const ys = pts.map((x) => Math.log(x.tvoc));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxx = 0;
  let sxy = 0;
  xs.forEach((x, i) => {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (ys[i] - my);
  });
  return sxx > 0 ? sxy / sxx : null;
}

/**
 * input: { tvoc, suhu, rh, features?: { hours, tvocBaseline, tempMean, readings, recent: [{hours,tvoc}] } }
 * Tanpa features (mis. dipanggil langsung), dianggap tahu baru masuk dan hanya suhu yang dipakai.
 */
function predictMock(input, p = PARAMS) {
  const f = input.features || {};
  const hours = Math.max(0, Number(f.hours) || 0);
  const temp = Number.isFinite(f.tempMean) ? f.tempMean : Number(input.suhu);
  const prior = Math.max(0, expectedLifeHours(temp, p) - hours);
  let hoursLeft = prior;
  let basis = 'suhu';

  const base = Math.max(p.MIN_BASE, Number(f.tvocBaseline) || 0);
  const R = Number(input.tvoc) / base;
  if (hours >= p.WARMUP_H && (f.readings || 0) >= 6 && Number.isFinite(R)) {
    if (R >= p.R_SPOIL) {
      hoursLeft = 0;
      basis = 'tvoc';
    } else if (R >= p.R_ONSET) {
      const onset = (p.ONSET_TO_SPOIL_H * Math.log(p.R_SPOIL / R)) / Math.log(p.R_SPOIL / p.R_ONSET);
      let est = onset;
      const slope = logSlope(f.recent || []);
      if (slope !== null && slope > 0.05) est = 0.5 * onset + 0.5 * Math.min(Math.log(p.R_SPOIL / R) / slope, 2 * onset);
      hoursLeft = Math.min(prior, est);
      basis = 'tvoc';
    }
  }
  return { shelfLifeJam: Math.round(hoursLeft * 100) / 100, modelUsed: 'mock', basis, tvocRatio: Number.isFinite(R) ? Math.round(R * 10) / 10 : null };
}

module.exports = { TSL_TABLE, baseTslHours, predictMock, expectedLifeHours, PARAMS };
