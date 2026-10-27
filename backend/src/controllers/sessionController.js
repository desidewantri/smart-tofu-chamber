const Session = require('../models/Session');
const Prediction = require('../models/Prediction');
const SensorReading = require('../models/SensorReading');
const SystemSetting = require('../models/SystemSetting');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { isObjectId, parsePaging } = require('../utils/params');
const { sessionView, readingView, downsample } = require('../utils/presenters');

async function findSession(idOrCode) {
  const s = isObjectId(idOrCode)
    ? await Session.findById(idOrCode)
    : await Session.findOne({ sesiCode: String(idOrCode).toUpperCase() });
  if (!s) throw new ApiError(404, 'Sesi tidak ditemukan');
  return s;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GET /api/sesi?chamberId=&status=&q=&from=&to=&sort=sisa|masuk&page=&limit=
 * Default urut: sisa waktu terkecil dulu (sesuai proposal). Riwayat memakai sort=masuk.
 */
exports.list = asyncHandler(async (req, res) => {
  const settings = await SystemSetting.get();
  const { page, limit } = parsePaging(req.query);
  const filter = {};
  if (req.query.chamberId) filter.chamberId = Number(req.query.chamberId);
  if (req.query.status === 'aktif' || req.query.status === 'selesai') filter.status = req.query.status;
  if (req.query.q) filter.sesiCode = new RegExp(escapeRegex(String(req.query.q).trim()), 'i');
  if (req.query.from || req.query.to) {
    filter.masuk = {};
    if (req.query.from) filter.masuk.$gte = new Date(req.query.from);
    if (req.query.to) {
      const to = new Date(req.query.to);
      to.setUTCHours(23, 59, 59, 999);
      filter.masuk.$lte = to;
    }
  }
  // Filter "Status Akhir" (Layak Jual / Segera Jual / Tidak Layak Jual)
  if (req.query.statusAkhir) filter.statusAkhir = String(req.query.statusAkhir);

  const sessions = await Session.find(filter).lean();
  const now = Date.now();
  let views = sessions.map((s) => sessionView(s, settings.zones, now));

  if (req.query.sort === 'masuk') {
    views.sort((a, b) => new Date(b.masuk) - new Date(a.masuk));
  } else {
    views.sort((a, b) => (a.sisaDetik ?? Infinity) - (b.sisaDetik ?? Infinity));
  }

  const total = views.length;
  views = views.slice((page - 1) * limit, page * limit);
  res.json({ success: true, data: { items: views, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) } });
});

/** GET /api/sesi/:id  (ObjectId atau kode CH-001): detail + statistik + deret waktu */
exports.detail = asyncHandler(async (req, res) => {
  const settings = await SystemSetting.get();
  const session = await findSession(req.params.id);
  const [readings, preds] = await Promise.all([
    SensorReading.find({ sesiId: session._id }).sort({ timestamp: 1 }).lean(),
    Prediction.find({ sesiId: session._id }).sort({ prediksiDibuat: 1 }).lean(),
  ]);

  const stat = (key) => {
    const v = readings.map((r) => r[key]);
    if (!v.length) return null;
    return {
      min: Math.min(...v),
      max: Math.max(...v),
      avg: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100,
    };
  };
  const t0 = new Date(session.masuk).getTime();
  res.json({
    success: true,
    data: {
      session: sessionView(session, settings.zones),
      stats: { tvoc: stat('tvoc'), suhu: stat('suhu'), rh: stat('rh'), readings: readings.length, predictions: preds.length },
      readings: downsample(readings.map(readingView)),
      predictions: downsample(
        preds.map((p) => ({
          t: p.prediksiDibuat,
          elapsedHours: Math.round(((new Date(p.prediksiDibuat) - t0) / 3600000) * 100) / 100,
          shelfLifeJam: p.shelfLifeJam,
          modelUsed: p.modelUsed,
        }))
      ),
    },
  });
});

/** GET /api/sesi/:id/prediksi */
exports.predictions = asyncHandler(async (req, res) => {
  const session = await findSession(req.params.id);
  const limit = Math.min(1000, parseInt(req.query.limit, 10) || 200);
  const items = await Prediction.find({ sesiId: session._id }).sort({ prediksiDibuat: -1 }).limit(limit).lean();
  res.json({ success: true, data: items });
});

/** GET /api/sesi/:id/sensor */
exports.sensors = asyncHandler(async (req, res) => {
  const session = await findSession(req.params.id);
  const items = await SensorReading.find({ sesiId: session._id }).sort({ timestamp: 1 }).lean();
  res.json({ success: true, data: downsample(items.map(readingView), 500) });
});
