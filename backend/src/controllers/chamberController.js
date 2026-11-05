const Chamber = require('../models/Chamber');
const Session = require('../models/Session');
const SensorReading = require('../models/SensorReading');
const Experiment = require('../models/Experiment');
const SystemSetting = require('../models/SystemSetting');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { parseChamberId } = require('../utils/params');
const { chamberView, sessionView, experimentView, readingView, sensorZones } = require('../utils/presenters');
const { closeSessionFields } = require('../services/sessionLifecycleService');
const rslService = require('../services/rslService');

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
    .filter((c) => !q || c.name.toLowerCase().includes(q));

  res.json({ success: true, data: items });
});

exports.detail = asyncHandler(async (req, res) => {
  const chamberId = parseChamberId(req.params.id);
  const settings = await SystemSetting.get();
  const chamber = await Chamber.findOne({ chamberId });
  if (!chamber) throw new ApiError(404, 'Chamber tidak ditemukan');

  const active = await Session.findOne({ chamberId, status: 'aktif' });
  const experiment = active?.experimentId
    ? await Experiment.findById(active.experimentId).lean()
    : null;
  const latest = active
    ? await SensorReading.findOne({ sesiId: active._id }).sort({ timestamp: -1 }).lean()
    : await SensorReading.findOne({ chamberId }).sort({ timestamp: -1 }).lean();
  const rsl = active && experiment
    ? await rslService.estimateForSession({ experiment, session: active, now: Date.now() })
    : null;
  const recent = await Session.find({ chamberId, status: 'selesai' }).sort({ selesai: -1 }).limit(5);
  const expIds = [...new Set(recent.map((s) => s.experimentId).filter(Boolean).map(String))];
  const exps = expIds.length ? await Experiment.find({ _id: { $in: expIds } }).lean() : [];
  const expMap = new Map(exps.map((e) => [String(e._id), e]));

  res.json({
    success: true,
    data: {
      chamber: chamberView(chamber, settings),
      experiment: experimentView(experiment),
      activeSession: active ? sessionView(active, settings.zones, Date.now(), experiment?.startedAt) : null,
      latestReading: readingView(latest),
      sensors: sensorZones(latest, settings.thresholds),
      rsl,
      recentSessions: recent.map((s) =>
        sessionView(s, settings.zones, Date.now(), expMap.get(String(s.experimentId))?.startedAt)
      ),
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

  const parentExperiment = session.experimentId
    ? await Experiment.findById(session.experimentId).lean()
    : null;
  if (parentExperiment && parentExperiment.status !== 'aktif') {
    throw new ApiError(
      409,
      'Eksperimen sudah selesai; sesi harus ditutup oleh proses finalisasi',
      { code: 'EXPERIMENT_CLOSED' }
    );
  }

  const fields = closeSessionFields(session, settings);
  const updated = await Session.findByIdAndUpdate(session._id, { $set: fields }, { new: true });
  if (!updated) throw new ApiError(404, 'Sesi tidak ditemukan saat ditutup');
  const experiment = updated?.experimentId
    ? await Experiment.findById(updated.experimentId).lean()
    : null;

  res.json({
    success: true,
    message: `Sesi ${updated.sesiCode} di chamber ${chamberId} ditutup`,
    data: sessionView(updated, settings.zones, Date.now(), experiment?.startedAt),
  });
});
