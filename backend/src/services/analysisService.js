const Chamber = require('../models/Chamber');
const Session = require('../models/Session');
const Prediction = require('../models/Prediction');
const SensorReading = require('../models/SensorReading');
const SystemSetting = require('../models/SystemSetting');
const ApiError = require('../utils/ApiError');
const { classifyShelfLife, remainingSeconds, STATUS } = require('../utils/status');
const { sessionView, readingView, sensorZones, chamberView, downsample } = require('../utils/presenters');

const PERIODS = { '24h': 24, '7d': 168, '30d': 720, '90d': 2160, '180d': 4320, '365d': 8760 };
const periodToHours = (p, fallback) => PERIODS[p] || fallback;

/* ------------------------------------------------------------------ */
/* Fungsi murni (mudah diuji)                                          */
/* ------------------------------------------------------------------ */

const avg = (arr) => {
  const v = arr.filter((x) => typeof x === 'number' && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const round = (x, d = 2) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);

const PARAM_LABEL = { tvoc: 'TVOC', suhu: 'Suhu', rh: 'Kelembapan' };

function riskNote(param, zone) {
  const name = PARAM_LABEL[param];
  if (zone === 'Aman') return `${name} berada dalam batas aman; kontribusi terhadap risiko penurunan kualitas rendah.`;
  if (zone === 'Perhatian') return `${name} mendekati batas; pantau terus karena dapat mempercepat penurunan kualitas.`;
  if (zone === 'Bahaya') return `${name} melewati batas; kondisi ini berkaitan dengan risiko penurunan kualitas yang lebih cepat.`;
  return `${name}: belum ada data.`;
}

function buildInterpretation(status, sensors) {
  if (!status || !sensors) {
    return 'Belum ada data sesi aktif untuk dianalisis. Interpretasi akan muncul setelah chamber mengirim data.';
  }
  const bad = Object.entries(sensors)
    .filter(([, v]) => v.zone === 'Bahaya')
    .map(([k]) => PARAM_LABEL[k]);
  const warn = Object.entries(sensors)
    .filter(([, v]) => v.zone === 'Perhatian')
    .map(([k]) => PARAM_LABEL[k]);

  let lead;
  if (status === STATUS.LAYAK) lead = 'Perkiraan sisa umur simpan masih panjang; tahu layak dikonsumsi dengan tenang.';
  else if (status === STATUS.SEGERA) lead = 'Perkiraan sisa umur simpan mulai terbatas; sebaiknya tahu segera dikonsumsi.';
  else lead = 'Perkiraan sisa umur simpan sangat singkat; tahu tidak layak dikonsumsi dan perlu segera dikeluarkan.';

  const detail = bad.length
    ? ` Parameter yang melewati batas: ${bad.join(', ')}.`
    : warn.length
    ? ` Parameter yang perlu diperhatikan: ${warn.join(', ')}.`
    : ' Seluruh parameter berada dalam batas aman.';

  return (
    `${lead}${detail} TVOC, suhu, dan kelembapan adalah parameter yang berkontribusi pada prediksi model, ` +
    'bukan pengukuran langsung terhadap kondisi mikrobiologis tahu.'
  );
}

/** Analisis biaya & manfaat dari sesi yang sudah selesai. Semua angka bergantung pada asumsi di Settings. */
function computeCostBenefit(sessions, settings) {
  const b = settings.business;
  const done = sessions.filter((s) => s.status === 'selesai' && s.statusAkhir);
  const counts = { [STATUS.LAYAK]: 0, [STATUS.SEGERA]: 0, [STATUS.TIDAK]: 0 };
  done.forEach((s) => {
    if (counts[s.statusAkhir] !== undefined) counts[s.statusAkhir] += 1;
  });
  const mult = {
    [STATUS.LAYAK]: 1,
    [STATUS.SEGERA]: 1 - b.discountSegera,
    [STATUS.TIDAK]: 0,
  };
  const unit = b.batchKg * b.pricePerKg;
  const revenueWith = Object.entries(counts).reduce((sum, [k, n]) => sum + n * unit * mult[k], 0);
  const totalKg = done.length * b.batchKg;
  const revenueWithout = totalKg * (1 - b.lossRateWithoutSystem) * b.pricePerKg;
  const opCost = done.length * b.operationalCostPerSession;
  const net = revenueWith - revenueWithout - opCost;

  return {
    sessions: done.length,
    totalKg,
    counts,
    revenueWithSystem: Math.round(revenueWith),
    revenueWithoutSystem: Math.round(revenueWithout),
    operationalCost: Math.round(opCost),
    netBenefit: Math.round(net),
    assumptions: [
      `Berat tahu per sesi ${b.batchKg} kg, harga Rp${b.pricePerKg.toLocaleString('id-ID')}/kg.`,
      `Tahu "Segera Konsumsi" dijual dengan diskon ${Math.round(b.discountSegera * 100)}%; "Tidak Layak Konsumsi" dianggap tidak terjual.`,
      `Tanpa sistem diasumsikan ${Math.round(b.lossRateWithoutSystem * 100)}% tahu terbuang (asumsi, perlu divalidasi dengan data produsen).`,
      `Biaya operasional Rp${b.operationalCostPerSession.toLocaleString('id-ID')} per sesi.`,
    ],
  };
}

const RAINY_MONTHS = [10, 11, 12, 1, 2, 3];
const seasonOf = (month) => (RAINY_MONTHS.includes(month) ? 'hujan' : 'kemarau');

/** rows: [{ date, tvoc, suhu, rh, shelfLife }] -> rata-rata per bulan dan per musim. */
function groupSeasonal(rows) {
  const byMonth = new Map();
  rows.forEach((r) => {
    const d = new Date(r.date);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(r);
  });
  const months = [...byMonth.keys()]
    .sort()
    .map((key) => {
      const list = byMonth.get(key);
      const month = Number(key.slice(5));
      return {
        month: key,
        season: seasonOf(month),
        sessions: list.length,
        avgSuhu: round(avg(list.map((r) => r.suhu))),
        avgRh: round(avg(list.map((r) => r.rh))),
        avgTvoc: round(avg(list.map((r) => r.tvoc))),
        avgShelfLife: round(avg(list.map((r) => r.shelfLife))),
      };
    });

  const seasons = ['hujan', 'kemarau'].map((season) => {
    const list = rows.filter((r) => seasonOf(new Date(r.date).getUTCMonth() + 1) === season);
    return {
      season,
      sessions: list.length,
      avgSuhu: round(avg(list.map((r) => r.suhu))),
      avgRh: round(avg(list.map((r) => r.rh))),
      avgTvoc: round(avg(list.map((r) => r.tvoc))),
      avgShelfLife: round(avg(list.map((r) => r.shelfLife))),
    };
  });

  const h = seasons[0];
  const k = seasons[1];
  let insight = 'Data belum cukup untuk membandingkan musim hujan dan kemarau.';
  if (h.sessions >= 1 && k.sessions >= 1 && h.avgShelfLife && k.avgShelfLife) {
    const diff = ((k.avgShelfLife - h.avgShelfLife) / h.avgShelfLife) * 100;
    const longer = diff >= 0 ? 'kemarau' : 'hujan';
    insight =
      `Rata-rata perkiraan umur simpan awal lebih panjang pada musim ${longer} ` +
      `(selisih ${Math.abs(Math.round(diff))}%). Perbedaan suhu ruang (${h.avgSuhu}°C vs ${k.avgSuhu}°C) ` +
      'adalah faktor yang paling mungkin menjelaskannya. Ini deskripsi data, bukan bukti sebab-akibat.';
  }
  return { months, seasons, insight };
}

/* ------------------------------------------------------------------ */
/* Fungsi yang membaca database                                        */
/* ------------------------------------------------------------------ */

async function getCondition({ chamberId, period }) {
  const settings = await SystemSetting.get();
  const chamber = await Chamber.findOne({ chamberId });
  if (!chamber) throw new ApiError(404, 'Chamber tidak ditemukan');

  const hours = periodToHours(period, 24);
  const since = new Date(Date.now() - hours * 3600 * 1000);

  const session =
    (await Session.findOne({ chamberId, status: 'aktif' })) ||
    (await Session.findOne({ chamberId }).sort({ masuk: -1 }));

  const base = {
    chamber: chamberView(chamber, settings),
    period: period || '24h',
    session: null,
    status: null,
    remainingSeconds: null,
    shelfLifeHours: null,
    modelUsed: null,
    sensors: null,
    risks: null,
    interpretation: buildInterpretation(null, null),
    trend: [],
  };
  if (!session) return base;

  const [latest, preds] = await Promise.all([
    SensorReading.findOne({ sesiId: session._id }).sort({ timestamp: -1 }).lean(),
    Prediction.find({ sesiId: session._id, prediksiDibuat: { $gte: since } })
      .sort({ prediksiDibuat: 1 })
      .lean(),
  ]);

  const sisa = remainingSeconds(session.toObject());
  const status = sisa === null ? null : classifyShelfLife(sisa / 3600, settings.zones);
  const sensors = sensorZones(latest, settings.thresholds);
  const risks = sensors
    ? Object.fromEntries(Object.entries(sensors).map(([k, v]) => [k, riskNote(k, v.zone)]))
    : null;

  const trend = downsample(
    preds.map((p) => ({
      t: p.prediksiDibuat,
      elapsedHours: round((new Date(p.prediksiDibuat) - new Date(session.masuk)) / 3600000),
      shelfLife: p.shelfLifeJam,
    }))
  );

  return {
    ...base,
    session: sessionView(session, settings.zones),
    status,
    remainingSeconds: sisa,
    shelfLifeHours: session.shelfLifeAwal,
    modelUsed: session.modelUsed,
    sensors,
    risks,
    interpretation: buildInterpretation(status, sensors),
    trend,
  };
}

async function getCostBenefit({ chamberId, period }) {
  const settings = await SystemSetting.get();
  const since = new Date(Date.now() - periodToHours(period, 720) * 3600 * 1000);
  const filter = { status: 'selesai', selesai: { $gte: since } };
  if (chamberId) filter.chamberId = chamberId;
  const sessions = await Session.find(filter).lean();
  return { period: period || '30d', chamberId: chamberId || null, ...computeCostBenefit(sessions, settings) };
}

async function getSeasonal({ chamberId, period }) {
  const since = new Date(Date.now() - periodToHours(period, 8760) * 3600 * 1000);
  const filter = { masuk: { $gte: since }, shelfLifeMulai: { $ne: null } };
  if (chamberId) filter.chamberId = chamberId;
  const sessions = await Session.find(filter).lean();
  const rows = sessions.map((s) => ({
    date: s.masuk,
    tvoc: s.tvoc_awal,
    suhu: s.suhu_awal,
    rh: s.rh_awal,
    shelfLife: s.shelfLifeMulai,
  }));
  return { period: period || '365d', chamberId: chamberId || null, ...groupSeasonal(rows) };
}

module.exports = {
  PERIODS,
  periodToHours,
  buildInterpretation,
  riskNote,
  computeCostBenefit,
  groupSeasonal,
  seasonOf,
  getCondition,
  getCostBenefit,
  getSeasonal,
  readingView,
};
