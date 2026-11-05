const Experiment = require('../models/Experiment');
const Session = require('../models/Session');
const Chamber = require('../models/Chamber');
const SensorReading = require('../models/SensorReading');
const RslSnapshot = require('../models/RslSnapshot');
const SystemSetting = require('../models/SystemSetting');
const ApiError = require('../utils/ApiError');
const { closeExperimentSessions } = require('./sessionLifecycleService');
const rslService = require('./rslService');
const rslSnapshotService = require('./rslSnapshotService');

const CHAMBER_IDS = [1, 2];
const STORAGE_CONDITIONS = ['DRY', 'WATER', 'UNKNOWN'];

function normalizeStorageCondition(value, fallback = 'DRY') {
  if (value === undefined || value === null || value === '') return fallback;
  const condition = String(value).trim().toUpperCase();
  if (!STORAGE_CONDITIONS.includes(condition)) {
    throw new ApiError(400, 'storageCondition harus DRY, WATER, atau UNKNOWN', {
      code: 'INVALID_STORAGE_CONDITION',
    });
  }
  return condition;
}

function normalizeLabel(label) {
  if (label === undefined || label === null) return null;
  const text = String(label).trim();
  if (!text) return null;
  if (text.length > 120) throw new ApiError(400, 'label eksperimen maksimal 120 karakter');
  return text;
}

async function ensureChambers(models) {
  const { Chamber: ChamberModel } = models;
  const chambers = [];
  for (const chamberId of CHAMBER_IDS) {
    let chamber = await ChamberModel.findOne({ chamberId });
    if (!chamber) {
      try {
        chamber = await ChamberModel.create({
          chamberId,
          code: ChamberModel.codeFor(chamberId),
          name: `Chamber ${chamberId}`,
          enabled: true,
        });
      } catch (err) {
        // Concurrent start may have created it first.
        if (err.code === 11000) chamber = await ChamberModel.findOne({ chamberId });
        else throw err;
      }
    }
    if (!chamber) throw new ApiError(500, `Gagal menyiapkan chamber ${chamberId}`);
    if (chamber.enabled === false) {
      throw new ApiError(409, `Chamber ${chamberId} sedang dinonaktifkan`, {
        code: 'CHAMBER_DISABLED',
        chamberId,
      });
    }
    chambers.push(chamber);
  }
  return chambers;
}

async function activeSessionsForChambers(models) {
  const { Session: SessionModel } = models;
  return SessionModel.find({ chamberId: { $in: CHAMBER_IDS }, status: 'aktif' });
}

async function createSessionForExperiment(experiment, chamberId, SessionModel) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const last = await SessionModel.findOne().sort({ seq: -1 }).select('seq').lean();
    const seq = (last?.seq || 0) + 1;
    try {
      return await SessionModel.create({
        seq,
        sesiCode: SessionModel.codeFor(seq),
        experimentId: experiment._id,
        chamberId,
        status: 'aktif',
        masuk: null,
        sampleStatus: 'UNKNOWN',
        storageCondition: experiment.storageCondition || 'DRY',
      });
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  throw new ApiError(500, 'Gagal membuat sesi eksperimen');
}

/**
 * Create one experiment and exactly two active chamber sessions. No sensor
 * values or first-reading timestamp are fabricated here; those are populated
 * by the first accepted reading.
 */
async function startExperiment({ label, storageCondition } = {}, deps = {}) {
  const models = deps.models || { Experiment, Session, Chamber };
  const { Experiment: ExperimentModel, Session: SessionModel } = models;
  const normalizedLabel = normalizeLabel(label);
  const normalizedStorage = normalizeStorageCondition(storageCondition);

  const active = await ExperimentModel.findOne({ status: 'aktif' });
  if (active) {
    throw new ApiError(409, 'Eksperimen aktif sudah berjalan', {
      code: 'ACTIVE_EXPERIMENT_EXISTS',
      experimentId: String(active._id),
      label: active.label || null,
      startedAt: active.startedAt,
    });
  }

  // Do not create chamber documents or any experiment record if a legacy
  // active session still owns one of the chambers.
  const activeSessions = await activeSessionsForChambers(models);
  if (activeSessions.length) {
    throw new ApiError(
      409,
      'Sesi aktif lama masih berjalan; tutup sesi tersebut sebelum memulai eksperimen baru',
      {
        code: 'LEGACY_ACTIVE_SESSION',
        sessions: activeSessions.map((s) => ({
          id: String(s._id),
          sesiCode: s.sesiCode,
          chamberId: s.chamberId,
          masuk: s.masuk || null,
          experimentId: s.experimentId ? String(s.experimentId) : null,
        })),
      }
    );
  }

  await ensureChambers(models);

  const startedAt = new Date();
  let experiment;
  try {
    experiment = await ExperimentModel.create({
      label: normalizedLabel || `Eksperimen ${startedAt.toISOString()}`,
      startedAt,
      status: 'aktif',
      chamberIds: CHAMBER_IDS.slice(),
      storageCondition: normalizedStorage,
    });
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, 'Eksperimen aktif sudah berjalan', {
        code: 'ACTIVE_EXPERIMENT_EXISTS',
      });
    }
    throw err;
  }

  const sessions = [];
  try {
    for (const chamberId of CHAMBER_IDS) {
      sessions.push(await createSessionForExperiment(experiment, chamberId, SessionModel));
    }
  } catch (err) {
    // No transactions assumed: compensate only the records created by this call.
    try {
      await SessionModel.deleteMany({ experimentId: experiment._id });
    } catch {
      /* best-effort cleanup */
    }
    try {
      await ExperimentModel.deleteOne({ _id: experiment._id });
    } catch {
      /* best-effort cleanup */
    }
    if (err.code === 11000) {
      throw new ApiError(409, 'Sesi aktif lain muncul saat memulai eksperimen', {
        code: 'CONCURRENT_ACTIVE_SESSION',
      });
    }
    throw err;
  }

  return { experiment, sessions };
}

/**
 * Close the experiment and both associated chamber sessions with one shared
 * server timestamp. The experiment closure is durably persisted as PENDING
 * before snapshots are attempted; snapshots are reconciled against the stored
 * endedAt and the experiment is marked COMPLETE only after both canonical
 * documents are verified.
 *
 * Repeated calls return the existing state. Snapshot persistence failures are
 * logged/returned but never turn a durable experiment closure into a false
 * "still running" claim.
 */
async function stopExperiment(id, deps = {}) {
  const models = deps.models || { Experiment, Session, RslSnapshot, SensorReading };
  const {
    Experiment: ExperimentModel,
    Session: SessionModel,
    RslSnapshot: SnapshotModel = RslSnapshot,
    SensorReading: ReadingModel = SensorReading,
  } = models;
  const estimator = deps.rslEstimator || rslService;
  const settings = deps.settings || (await SystemSetting.get());
  const experiment = await ExperimentModel.findById(id);
  if (!experiment) throw new ApiError(404, 'Eksperimen tidak ditemukan');

  let sessions = await SessionModel.find({ experimentId: experiment._id });

  if (experiment.status === 'selesai') {
    const closureErrors = await closeExperimentSessions({
      sessions,
      SessionModel,
      settings,
      endedAt: experiment.endedAt,
    });
    const snapshots = await SnapshotModel.find({ experimentId: experiment._id }).sort({
      chamberId: 1,
    });
    return {
      experiment,
      sessions: await SessionModel.find({ experimentId: experiment._id }),
      snapshots,
      snapshotErrors: closureErrors,
      snapshotStatus: experiment.rslSnapshotStatus || null,
      alreadyStopped: true,
    };
  }

  const endedAt = new Date();
  const closed = await ExperimentModel.findOneAndUpdate(
    { _id: experiment._id, status: 'aktif' },
    {
      $set: {
        status: 'selesai',
        endedAt,
        rslSnapshotStatus: 'PENDING',
        rslSnapshotExpectedCount: 2,
        rslSnapshotCompletedCount: 0,
        rslSnapshotLastAttemptAt: null,
        rslSnapshotLastErrorCode: null,
        rslSnapshotRecoveredAt: null,
        rslSnapshotAttempts: 0,
        rslSnapshotNextAttemptAt: null,
        rslSnapshotLeaseUntil: null,
        rslSnapshotLeaseOwner: null,
        finalizationStatus: 'PENDING',
        finalizationExpectedSessionCount: 2,
        finalizationClosedSessionCount: 0,
        finalizationLastAttemptAt: null,
        finalizationLastErrorCode: null,
        finalizationRecoveredAt: null,
        finalizationAttempts: 0,
        finalizationNextAttemptAt: null,
      },
    },
    { new: true }
  );
  if (!closed) {
    const current = await ExperimentModel.findById(experiment._id);
    if (current?.status === 'selesai') {
      const snapshots = await SnapshotModel.find({ experimentId: experiment._id }).sort({
        chamberId: 1,
      });
      return {
        experiment: current,
        sessions: await SessionModel.find({ experimentId: experiment._id }),
        snapshots,
        snapshotErrors: [],
        snapshotStatus: current.rslSnapshotStatus || null,
        alreadyStopped: true,
      };
    }
    throw new ApiError(500, 'Gagal menyimpan penutupan eksperimen', {
      code: 'EXPERIMENT_CLOSURE_FAILED',
    });
  }

  const closureErrors = await closeExperimentSessions({
    sessions,
    SessionModel,
    settings,
    endedAt,
  });

  const reconciliation = await rslSnapshotService.reconcileExperiment(closed, {
    models: {
      Experiment: ExperimentModel,
      Session: SessionModel,
      RslSnapshot: SnapshotModel,
      SensorReading: ReadingModel,
    },
    rslEstimator: estimator,
    settings,
    now: endedAt.getTime(),
  });

  const updated = await ExperimentModel.findById(experiment._id);
  const updatedSessions = await SessionModel.find({ experimentId: experiment._id });
  const snapshots = await SnapshotModel.find({ experimentId: experiment._id }).sort({
    chamberId: 1,
  });
  const snapshotErrors = [...closureErrors, ...(reconciliation.errors || [])];
  if (reconciliation.status === 'pending' && snapshotErrors.length === 0) {
    snapshotErrors.push({
      code: reconciliation.errorCode || 'SNAPSHOT_RECONCILIATION_PENDING',
    });
  }
  const finalizationErrors = snapshotErrors.filter((error) =>
    /SESSION|FINALIZATION|AMBIGUOUS/.test(error.code || '')
  );

  return {
    experiment: updated || closed,
    sessions: updatedSessions,
    snapshots,
    snapshotErrors,
    finalizationErrors,
    snapshotStatus: updated?.rslSnapshotStatus || reconciliation.status.toUpperCase(),
    finalizationStatus: updated?.finalizationStatus || 'PENDING',
    alreadyStopped: false,
  };
}

async function getExperiment(id, deps = {}) {
  const models = deps.models || { Experiment, Session };
  const experiment = await models.Experiment.findById(id);
  if (!experiment) throw new ApiError(404, 'Eksperimen tidak ditemukan');
  const sessions = await models.Session.find({ experimentId: experiment._id }).sort({ chamberId: 1 });
  return { experiment, sessions };
}

async function getActiveExperiment(deps = {}) {
  const models = deps.models || { Experiment, Session };
  const experiment = await models.Experiment.findOne({ status: 'aktif' });
  if (!experiment) return null;
  const sessions = await models.Session.find({ experimentId: experiment._id }).sort({ chamberId: 1 });
  return { experiment, sessions };
}

async function listExperiments({ status, limit } = {}, deps = {}) {
  const models = deps.models || { Experiment };
  const filter = {};
  if (status !== undefined && status !== '') {
    if (status !== 'aktif' && status !== 'selesai') {
      throw new ApiError(400, 'status eksperimen harus aktif atau selesai');
    }
    filter.status = status;
  }
  const n = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  return models.Experiment.find(filter).sort({ startedAt: -1 }).limit(n);
}

module.exports = {
  CHAMBER_IDS,
  startExperiment,
  stopExperiment,
  getExperiment,
  getActiveExperiment,
  listExperiments,
  normalizeLabel,
  normalizeStorageCondition,
  STORAGE_CONDITIONS,
};
