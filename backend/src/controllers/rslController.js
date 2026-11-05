const asyncHandler = require('../utils/asyncHandler');
const SystemSetting = require('../models/SystemSetting');
const ApiError = require('../utils/ApiError');
const { parseChamberId } = require('../utils/params');
const { experimentView, sessionView, rslSnapshotView } = require('../utils/presenters');
const rslService = require('../services/rslService');
const rslSnapshotService = require('../services/rslSnapshotService');

/** GET /api/experiments/:id/rsl/:chamberId */
exports.forChamber = asyncHandler(async (req, res) => {
  const chamberId = parseChamberId(req.params.chamberId);
  const data = await rslService.estimateForExperimentChamber(req.params.id, chamberId);
  res.json({ success: true, data });
});

/** GET /api/experiments/:id/rsl/:chamberId/analysis — M2/M3 supporting detail. */
exports.analysis = asyncHandler(async (req, res) => {
  const chamberId = parseChamberId(req.params.chamberId);
  const data = await rslService.estimateForExperimentChamber(req.params.id, chamberId);
  res.json({
    success: true,
    data: {
      experimentId: data.experimentId,
      sessionId: data.sessionId,
      chamberId: data.chamberId,
      sampleStatus: data.sampleStatus,
      storageCondition: data.storageCondition,
      elapsedHours: data.elapsedHours,
      status: data.status,
      reason: data.reason,
      message: data.message,
      supporting: data.supporting,
      metadata: data.metadata,
    },
  });
});

/** GET /api/rsl/snapshots?chamberId=&limit= — immutable historical results. */
exports.snapshots = asyncHandler(async (req, res) => {
  const chamberId = parseChamberId(req.query.chamberId);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const items = await rslSnapshotService.listForChamber({ chamberId, limit });
  res.json({
    success: true,
    data: {
      chamberId,
      limit,
      items: items.map(rslSnapshotView),
    },
  });
});

/** PATCH /api/experiments/:id/sessions/:sessionId/sample-status */
exports.updateSampleStatus = asyncHandler(async (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    throw new ApiError(400, 'Body harus berupa objek JSON');
  }
  const { experiment, session } = await rslService.updateSampleStatus({
    experimentId: req.params.id,
    sessionId: req.params.sessionId,
    sampleStatus: req.body.sampleStatus,
    storageCondition: req.body.storageCondition,
    userId: req.user?._id || null,
  });
  const settings = await SystemSetting.get();
  res.json({
    success: true,
    data: {
      experiment: experimentView(experiment),
      session: sessionView(session, settings.zones, Date.now(), experiment.startedAt),
    },
  });
});
