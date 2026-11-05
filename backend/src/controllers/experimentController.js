const asyncHandler = require('../utils/asyncHandler');
const SystemSetting = require('../models/SystemSetting');
const RslSnapshot = require('../models/RslSnapshot');
const { experimentView, sessionView, rslSnapshotView } = require('../utils/presenters');
const experimentService = require('../services/experimentService');

async function present(experiment, sessions, snapshots = null) {
  const settings = await SystemSetting.get();
  const finalSnapshots =
    snapshots === null
      ? await RslSnapshot.find({ experimentId: experiment._id }).sort({ chamberId: 1 }).lean()
      : snapshots;
  return {
    experiment: experimentView(experiment),
    sessions: (sessions || []).map((s) =>
      sessionView(s, settings.zones, Date.now(), experiment.startedAt)
    ),
    snapshots: (finalSnapshots || []).map(rslSnapshotView),
  };
}

/** POST /api/experiments */
exports.start = asyncHandler(async (req, res) => {
  const { experiment, sessions } = await experimentService.startExperiment({
    label: req.body?.label,
    storageCondition: req.body?.storageCondition,
  });
  res.status(201).json({ success: true, data: await present(experiment, sessions) });
});

/** POST /api/experiments/:id/stop */
exports.stop = asyncHandler(async (req, res) => {
  const {
    experiment,
    sessions,
    snapshots,
    snapshotErrors,
    finalizationErrors,
    alreadyStopped,
  } = await experimentService.stopExperiment(req.params.id);
  res.json({
    success: true,
    data: {
      ...(await present(experiment, sessions, snapshots)),
      alreadyStopped: Boolean(alreadyStopped),
      snapshotErrors: snapshotErrors || [],
      finalizationErrors: finalizationErrors || [],
    },
  });
});

/** GET /api/experiments?status=&limit= */
exports.list = asyncHandler(async (req, res) => {
  const items = await experimentService.listExperiments({
    status: req.query.status,
    limit: req.query.limit,
  });
  res.json({ success: true, data: items.map(experimentView) });
});

/** GET /api/experiments/active */
exports.active = asyncHandler(async (_req, res) => {
  const active = await experimentService.getActiveExperiment();
  if (!active) {
    res.json({ success: true, data: null });
    return;
  }
  res.json({ success: true, data: await present(active.experiment, active.sessions) });
});

/** GET /api/experiments/:id */
exports.detail = asyncHandler(async (req, res) => {
  const { experiment, sessions } = await experimentService.getExperiment(req.params.id);
  res.json({ success: true, data: await present(experiment, sessions) });
});
