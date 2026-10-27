const Chamber = require('../models/Chamber');
const Session = require('../models/Session');
const SensorReading = require('../models/SensorReading');
const SystemSetting = require('../models/SystemSetting');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { parseChamberId } = require('../utils/params');
const { classifyShelfLife, remainingSeconds } = require('../utils/status');
const { chamberView, sessionView, readingView, sensorZones } = require('../utils/presenters');

exports.list = asyncHandler(async (req, res) => {
  const settings = await SystemSetting.get();
  const q = String(req.query.q || '').trim().toLowerCase();
  const chambers = await Chamber.find().sort({ chamberId: 1 });
  const active = await Session.find({ status: 'aktif' });
  const activeBy = new Map(active.map((s) => [s.chamberId, s]));

  const items = chambers
    .map((c) => {
      const view = chamberView(c, settings);
      const s = activeBy.get(c.chamberId);
      return { ...view, sesiSaatIni: s ? s.sesiCode : null };
    })
    .filter((c) => !q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));

  res.json({ success: true, data: items });
});

exports.create = asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) throw new ApiError(400, 'Nama chamber wajib diisi');
  const last = await Chamber.findOne().sort({ chamberId: -1 }).select('chamberId').lean();
  const chamberId = (last?.chamberId || 0) + 1;
  const chamber = await Chamber.create({
    chamberId,
    code: Chamber.codeFor(chamberId),
    name,
    enabled: req.body?.enabled !== false,
  });
  const settings = await SystemSetting.get();
  res.status(201).json({ success: true, message: `Chamber ${chamber.code} ditambahkan`, data: chamberView(chamber, settings) });
});

exports.detail = asyncHandler(async (req, res) => {
  const chamberId = parseChamberId(req.params.id);
  const settings = await SystemSetting.get();
  const chamber = await Chamber.findOne({ chamberId });
  if (!chamber) throw new ApiError(404, 'Chamber tidak ditemukan');

  const active = await Session.findOne({ chamberId, status: 'aktif' });
  const latest = await SensorReading.findOne({ chamberId }).sort({ timestamp: -1 }).lean();
  const recent = await Session.find({ chamberId, status: 'selesai' }).sort({ selesai: -1 }).limit(5);

  res.json({
    success: true,
    data: {
      chamber: chamberView(chamber, settings),
      activeSession: active ? sessionView(active, settings.zones) : null,
      latestReading: readingView(latest),
      sensors: sensorZones(latest, settings.thresholds),
      recentSessions: recent.map((s) => sessionView(s, settings.zones)),
    },
  });
});

exports.update = asyncHandler(async (req, res) => {
  const chamberId = parseChamberId(req.params.id);
  const chamber = await Chamber.findOne({ chamberId });
  if (!chamber) throw new ApiError(404, 'Chamber tidak ditemukan');
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) throw new ApiError(400, 'Nama tidak boleh kosong');
    chamber.name = name;
  }
  if (req.body?.enabled !== undefined) chamber.enabled = Boolean(req.body.enabled);
  await chamber.save();
  const settings = await SystemSetting.get();
  res.json({ success: true, message: 'Chamber diperbarui', data: chamberView(chamber, settings) });
});

/** POST /api/chambers/:id/selesai  ("Tahu Sudah Keluar") */
exports.closeSession = asyncHandler(async (req, res) => {
  const chamberId = parseChamberId(req.params.id);
  const settings = await SystemSetting.get();
  const session = await Session.findOne({ chamberId, status: 'aktif' });
  if (!session) throw new ApiError(404, `Tidak ada sesi aktif di chamber ${chamberId}`);

  const sisa = remainingSeconds(session.toObject());
  session.status = 'selesai';
  session.selesai = new Date();
  session.statusAkhir = sisa === null ? null : classifyShelfLife(sisa / 3600, settings.zones);
  session.sisaAkhirJam = sisa === null ? null : Math.round((sisa / 3600) * 100) / 100;
  await session.save();

  res.json({
    success: true,
    message: `Sesi ${session.sesiCode} di chamber ${chamberId} ditutup`,
    data: sessionView(session, settings.zones),
  });
});
