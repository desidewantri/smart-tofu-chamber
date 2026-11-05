/**
 * Durable RSL snapshot reconciliation.
 *
 * A snapshot records the outcome at the original experiment stop boundary. It is
 * not a live estimate. The service only fills missing canonical documents and
 * verifies persisted documents before marking an experiment COMPLETE.
 */
const env = require('../config/env');
const Experiment = require('../models/Experiment');
const Session = require('../models/Session');
const SensorReading = require('../models/SensorReading');
const RslSnapshot = require('../models/RslSnapshot');
const SystemSetting = require('../models/SystemSetting');
const rslService = require('./rslService');
const { closeExperimentSessions } = require('./sessionLifecycleService');

const DEFAULT_MAX_BATCH = 10;
const LEASE_MS = 60_000;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 60 * 60 * 1000;
const CHAMBERS = [1, 2];

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const time = (value) => (value ? new Date(value).getTime() : null);

function ownerId() {
  return `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function backoffMs(attempts) {
  const exponent = Math.max(0, Math.min(Number(attempts) || 0, 6));
  return Math.min(BACKOFF_BASE_MS * 2 ** exponent, BACKOFF_MAX_MS);
}

async function captureSnapshot({
  experiment,
  session,
  endedAt,
  estimator,
  SnapshotModel,
  ReadingModel,
}) {
  const result = await estimator.estimateForSession({
    experiment,
    session,
    now: endedAt,
    // The experiment/session are already closed by the time reconciliation
    // runs; the original endedAt is the calculation boundary.
    allowClosed: true,
  });
  const latest = await ReadingModel.findOne({ sesiId: session._id })
    .sort({ timestamp: -1 })
    .lean();
  const available = result.status === 'AVAILABLE' && Boolean(result.primary);
  const elapsedHours =
    (new Date(endedAt).getTime() - new Date(experiment.startedAt).getTime()) / 3600000;
  const doc = {
    schemaVersion: 1,
    experimentId: experiment._id,
    sessionId: session._id,
    chamberId: session.chamberId,
    experimentLabel: experiment.label || null,
    sesiCode: session.sesiCode || null,
    storageCondition: result.storageCondition || session.storageCondition || 'DRY',
    snapshotAt: endedAt,
    endedAt,
    elapsedHours,
    sampleStatus: result.sampleStatus || session.sampleStatus || 'UNKNOWN',
    sampleStatusUpdatedAt: session.sampleStatusUpdatedAt || null,
    status: available ? 'AVAILABLE' : 'UNAVAILABLE',
    reason: available ? null : result.reason || 'ENGINE_INVALID_RESPONSE',
    message: available ? null : result.message || 'Estimasi RSL tidak tersedia',
    primary: result.primary || null,
    supporting: result.supporting || null,
    metadata: result.metadata || null,
    timestampQuality: latest?.timestampQuality || null,
    lastReadingAt: latest?.timestamp || null,
    readingCount: session.readingCount || 0,
  };
  try {
    return await SnapshotModel.findOneAndUpdate(
      { experimentId: experiment._id, chamberId: session.chamberId },
      { $setOnInsert: doc },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    if (err.code === 11000) {
      return SnapshotModel.findOne({
        experimentId: experiment._id,
        chamberId: session.chamberId,
      });
    }
    throw err;
  }
}

/**
 * Read-only historical RSL snapshots for one chamber. Snapshots are immutable
 * persisted outcomes; this never recalculates or fills missing values.
 */
async function listForChamber({ chamberId, limit = 20, models = null } = {}) {
  const SnapshotModel = models?.RslSnapshot || RslSnapshot;
  const max = Math.min(100, Math.max(1, Number(limit) || 20));
  return SnapshotModel.find({ chamberId: Number(chamberId) })
    .sort({ snapshotAt: -1 })
    .limit(max)
    .lean();
}

async function verifySnapshots({ experiment, SnapshotModel }) {
  const snapshots = await SnapshotModel.find({ experimentId: experiment._id }).lean();
  const expectedAt = time(experiment.endedAt);
  const errors = [];
  const byChamber = new Map();
  for (const snapshot of snapshots) {
    if (!CHAMBERS.includes(Number(snapshot.chamberId))) {
      errors.push({ code: 'UNEXPECTED_SNAPSHOT_CHAMBER', chamberId: snapshot.chamberId });
      continue;
    }
    if (byChamber.has(Number(snapshot.chamberId))) {
      errors.push({ code: 'DUPLICATE_SNAPSHOT_CHAMBER', chamberId: snapshot.chamberId });
      continue;
    }
    if (String(snapshot.experimentId) !== String(experiment._id)) {
      errors.push({ code: 'SNAPSHOT_EXPERIMENT_MISMATCH', chamberId: snapshot.chamberId });
      continue;
    }
    if (time(snapshot.snapshotAt) !== expectedAt) {
      errors.push({ code: 'SNAPSHOT_TIMESTAMP_MISMATCH', chamberId: snapshot.chamberId });
      continue;
    }
    byChamber.set(Number(snapshot.chamberId), snapshot);
  }
  const complete =
    errors.length === 0 && CHAMBERS.every((chamberId) => byChamber.has(chamberId));
  return {
    complete,
    snapshots: [...byChamber.values()].sort((a, b) => a.chamberId - b.chamberId),
    completedCount: byChamber.size,
    errors,
  };
}

function verifySessions({ experiment, sessions }) {
  const expectedAt = time(experiment.endedAt);
  const errors = [];
  const byChamber = new Map();
  for (const session of sessions || []) {
    const chamberId = Number(session.chamberId);
    if (!CHAMBERS.includes(chamberId)) {
      errors.push({ code: 'UNEXPECTED_SESSION_CHAMBER', chamberId });
      continue;
    }
    if (byChamber.has(chamberId)) {
      errors.push({ code: 'DUPLICATE_SESSION_CHAMBER', chamberId });
      continue;
    }
    if (String(session.experimentId) !== String(experiment._id)) {
      errors.push({ code: 'SESSION_EXPERIMENT_MISMATCH', chamberId });
      continue;
    }
    if (session.status !== 'selesai') {
      errors.push({ code: 'SESSION_STILL_ACTIVE', chamberId });
      continue;
    }
    const closedAt = time(session.selesai);
    if (closedAt === null) {
      errors.push({ code: 'SESSION_CLOSED_WITHOUT_TIMESTAMP', chamberId });
      continue;
    }
    if (expectedAt === null || closedAt > expectedAt + 1000) {
      errors.push({ code: 'SESSION_CLOSED_AFTER_EXPERIMENT_END', chamberId });
      continue;
    }
    byChamber.set(chamberId, session);
  }
  const complete =
    errors.length === 0 && CHAMBERS.every((chamberId) => byChamber.has(chamberId));
  return {
    complete,
    closedCount: byChamber.size,
    sessions: [...byChamber.values()].sort((a, b) => a.chamberId - b.chamberId),
    errors,
  };
}

function stateFilter(now) {
  const due = {
    $or: [
      { rslSnapshotNextAttemptAt: null },
      { rslSnapshotNextAttemptAt: { $exists: false } },
      { rslSnapshotNextAttemptAt: { $lte: new Date(now) } },
    ],
  };
  const lease = {
    $or: [
      { rslSnapshotLeaseUntil: null },
      { rslSnapshotLeaseUntil: { $exists: false } },
      { rslSnapshotLeaseUntil: { $lte: new Date(now) } },
    ],
  };
  const incomplete = {
    $or: [
      { rslSnapshotStatus: 'PENDING' },
      { rslSnapshotStatus: { $exists: false } },
      { rslSnapshotStatus: null },
      { rslSnapshotCompletedCount: { $lt: 2 } },
      { finalizationStatus: 'PENDING' },
      { finalizationStatus: { $exists: false } },
      { finalizationStatus: null },
      { finalizationClosedSessionCount: { $lt: 2 } },
    ],
  };
  const finalizationDue = {
    $or: [
      { finalizationNextAttemptAt: null },
      { finalizationNextAttemptAt: { $exists: false } },
      { finalizationNextAttemptAt: { $lte: new Date(now) } },
    ],
  };
  return {
    status: 'selesai',
    endedAt: { $ne: null },
    $and: [incomplete, due, finalizationDue, lease],
  };
}

async function claimNext({ now = Date.now(), ExperimentModel = Experiment } = {}) {
  return ExperimentModel.findOneAndUpdate(
    stateFilter(now),
    {
      $set: {
        rslSnapshotLeaseUntil: new Date(now + LEASE_MS),
        rslSnapshotLeaseOwner: ownerId(),
      },
    },
    { new: true, sort: { endedAt: 1 } }
  );
}

async function releaseLease(ExperimentModel, experimentId) {
  await ExperimentModel.updateOne(
    { _id: experimentId },
    { $set: { rslSnapshotLeaseUntil: null, rslSnapshotLeaseOwner: null } }
  );
}

function baseResult(status, extra = {}) {
  return {
    status,
    snapshotsCreated: 0,
    snapshotsAlreadyPresent: 0,
    snapshotsUnavailable: 0,
    experimentsCompleted: 0,
    experimentsFinalized: 0,
    sessionsClosed: 0,
    finalizationStatus: null,
    finalizationClosedSessionCount: 0,
    retriesScheduled: 0,
    failures: 0,
    errors: [],
    ...extra,
  };
}

/**
 * Reconcile one experiment. Existing snapshots are never recalculated or
 * replaced. Missing snapshots are created at the original experiment.endedAt.
 */
async function reconcileExperiment(experimentOrId, deps = {}) {
  const models = deps.models || {};
  const ExperimentModel = models.Experiment || Experiment;
  const SessionModel = models.Session || Session;
  const SnapshotModel = models.RslSnapshot || RslSnapshot;
  const ReadingModel = models.SensorReading || SensorReading;
  const estimator = deps.rslEstimator || rslService;
  const now = deps.now || Date.now();
  const settings = deps.settings || (await SystemSetting.get());

  const experiment = plain(
    typeof experimentOrId === 'string'
      ? await ExperimentModel.findById(experimentOrId)
      : experimentOrId
  );
  if (!experiment) return baseResult('not_found');
  if (experiment.status !== 'selesai' || !experiment.endedAt) {
    return baseResult('not_eligible');
  }

  const sessions = await SessionModel.find({ experimentId: experiment._id }).lean();
  const byChamber = new Map();
  for (const session of sessions) {
    if (!CHAMBERS.includes(Number(session.chamberId))) continue;
    if (byChamber.has(Number(session.chamberId))) {
      const attempts = (experiment.rslSnapshotAttempts || 0) + 1;
      await ExperimentModel.findByIdAndUpdate(experiment._id, {
        $set: {
          rslSnapshotStatus: 'PENDING',
          rslSnapshotLastAttemptAt: new Date(now),
          rslSnapshotLastErrorCode: 'AMBIGUOUS_SESSION_ASSOCIATION',
          rslSnapshotAttempts: attempts,
          rslSnapshotNextAttemptAt: new Date(now + backoffMs(attempts - 1)),
          rslSnapshotLeaseUntil: null,
          rslSnapshotLeaseOwner: null,
          finalizationStatus: 'PENDING',
          finalizationLastAttemptAt: new Date(now),
          finalizationLastErrorCode: 'AMBIGUOUS_SESSION_ASSOCIATION',
          finalizationAttempts: attempts,
          finalizationNextAttemptAt: new Date(now + backoffMs(attempts - 1)),
        },
      });
      return baseResult('pending', {
        failures: 1,
        errorCode: 'AMBIGUOUS_SESSION_ASSOCIATION',
        errors: [{ code: 'AMBIGUOUS_SESSION_ASSOCIATION' }],
        retriesScheduled: 1,
      });
    }
    byChamber.set(Number(session.chamberId), session);
  }
  if (byChamber.size !== 2 || !byChamber.has(1) || !byChamber.has(2)) {
    const attempts = (experiment.rslSnapshotAttempts || 0) + 1;
    await ExperimentModel.findByIdAndUpdate(experiment._id, {
      $set: {
        rslSnapshotStatus: 'PENDING',
        rslSnapshotLastAttemptAt: new Date(now),
        rslSnapshotLastErrorCode: 'AMBIGUOUS_SESSION_ASSOCIATION',
        rslSnapshotAttempts: attempts,
        rslSnapshotNextAttemptAt: new Date(now + backoffMs(attempts - 1)),
        rslSnapshotLeaseUntil: null,
        rslSnapshotLeaseOwner: null,
        finalizationStatus: 'PENDING',
        finalizationLastAttemptAt: new Date(now),
        finalizationLastErrorCode: 'AMBIGUOUS_SESSION_ASSOCIATION',
        finalizationAttempts: attempts,
        finalizationNextAttemptAt: new Date(now + backoffMs(attempts - 1)),
      },
    });
    return baseResult('pending', {
      failures: 1,
      errorCode: 'AMBIGUOUS_SESSION_ASSOCIATION',
      errors: [{ code: 'AMBIGUOUS_SESSION_ASSOCIATION' }],
      retriesScheduled: 1,
    });
  }

  // If a session is still active after closure (e.g. crash between experiment
  // closure and session closure), close it with the original endedAt. This never
  // reopens or changes an already-closed session.
  const activeBefore = sessions.filter((session) => session.status === 'aktif').length;
  const closureErrors = await closeExperimentSessions({
    sessions,
    SessionModel,
    settings,
    endedAt: experiment.endedAt,
  });

  const existing = await SnapshotModel.find({ experimentId: experiment._id }).lean();
  const existingByChamber = new Map(existing.map((s) => [Number(s.chamberId), s]));
  const legacyWithoutState = !experiment.rslSnapshotStatus;
  if (legacyWithoutState && existing.length === 0) {
    await ExperimentModel.findByIdAndUpdate(experiment._id, {
      $set: {
        rslSnapshotLastAttemptAt: new Date(now),
        rslSnapshotLastErrorCode: 'LEGACY_SNAPSHOT_CONTEXT_UNAVAILABLE',
        rslSnapshotNextAttemptAt: new Date(now + 24 * 60 * 60 * 1000),
        rslSnapshotLeaseUntil: null,
        rslSnapshotLeaseOwner: null,
      },
    });
    return baseResult('skipped_legacy', {
      snapshotsAlreadyPresent: 0,
      failures: closureErrors.length,
      errors: closureErrors,
    });
  }

  let snapshotsCreated = 0;
  let snapshotsAlreadyPresent = 0;
  let snapshotsUnavailable = 0;
  const failures = [...closureErrors];
  for (const chamberId of CHAMBERS) {
    if (existingByChamber.has(chamberId)) {
      snapshotsAlreadyPresent += 1;
      if (existingByChamber.get(chamberId).status === 'UNAVAILABLE') snapshotsUnavailable += 1;
      continue;
    }
    try {
      const snapshot = await captureSnapshot({
        experiment,
        session: byChamber.get(chamberId),
        endedAt: experiment.endedAt,
        estimator,
        SnapshotModel,
        ReadingModel,
      });
      if (snapshot) {
        snapshotsCreated += 1;
        if (snapshot.status === 'UNAVAILABLE') snapshotsUnavailable += 1;
      }
    } catch (err) {
      failures.push({
        code: 'SNAPSHOT_PERSISTENCE_FAILED',
        chamberId,
      });
      console.error(
        `[rsl-recovery] snapshot gagal untuk experiment ${experiment._id} chamber ${chamberId}: ${err.message}`
      );
    }
  }

  const snapshotVerification = await verifySnapshots({ experiment, SnapshotModel });
  const currentSessions = await SessionModel.find({ experimentId: experiment._id }).lean();
  const sessionVerification = verifySessions({ experiment, sessions: currentSessions });
  const activeAfter = currentSessions.filter((session) => session.status === 'aktif').length;
  const sessionsClosed = Math.max(0, activeBefore - activeAfter);
  const snapshotComplete = snapshotVerification.complete;
  const finalizationComplete = snapshotComplete && sessionVerification.complete;
  const completedCount = snapshotVerification.completedCount;
  const allFailures = [
    ...failures,
    ...snapshotVerification.errors,
    ...sessionVerification.errors,
  ];
  const snapshotErrorCode = snapshotComplete
    ? null
    : snapshotVerification.errors[0]?.code ||
      failures.find((failure) => failure.code === 'SNAPSHOT_PERSISTENCE_FAILED')?.code ||
      (completedCount > 0 ? 'SNAPSHOT_INCOMPLETE' : 'SNAPSHOT_MISSING');
  const finalizationErrorCode = finalizationComplete
    ? null
    : sessionVerification.errors[0]?.code ||
      snapshotErrorCode ||
      'FINALIZATION_INCOMPLETE';
  const snapshotAttempts = snapshotComplete ? 0 : (experiment.rslSnapshotAttempts || 0) + 1;
  const finalizationAttempts = finalizationComplete
    ? 0
    : (experiment.finalizationAttempts || 0) + 1;
  const snapshotNextAttemptAt = snapshotComplete
    ? null
    : new Date(now + backoffMs(snapshotAttempts - 1));
  const finalizationNextAttemptAt = finalizationComplete
    ? null
    : new Date(now + backoffMs(finalizationAttempts - 1));
  const set = {
    rslSnapshotStatus: snapshotComplete ? 'COMPLETE' : 'PENDING',
    rslSnapshotExpectedCount: 2,
    rslSnapshotCompletedCount: completedCount,
    rslSnapshotLastAttemptAt: new Date(now),
    rslSnapshotLastErrorCode: snapshotErrorCode,
    rslSnapshotAttempts: snapshotAttempts,
    rslSnapshotNextAttemptAt: snapshotNextAttemptAt,
    rslSnapshotLeaseUntil: null,
    rslSnapshotLeaseOwner: null,
    finalizationStatus: finalizationComplete ? 'COMPLETE' : 'PENDING',
    finalizationExpectedSessionCount: 2,
    finalizationClosedSessionCount: sessionVerification.closedCount,
    finalizationLastAttemptAt: new Date(now),
    finalizationLastErrorCode: finalizationErrorCode,
    finalizationAttempts,
    finalizationNextAttemptAt,
  };
  if (snapshotComplete) set.rslSnapshotRecoveredAt = new Date(now);
  if (finalizationComplete) set.finalizationRecoveredAt = new Date(now);

  let stateUpdateFailed = false;
  try {
    await ExperimentModel.findByIdAndUpdate(experiment._id, { $set: set }, { new: true });
  } catch (err) {
    stateUpdateFailed = true;
    failures.push({ code: 'FINALIZATION_STATE_UPDATE_FAILED' });
    console.error(
      `[rsl-recovery] gagal menyimpan state finalisasi ${experiment._id}: ${err.message}`
    );
    const snapshotAttempts = (experiment.rslSnapshotAttempts || 0) + 1;
    const finalizationAttempts = (experiment.finalizationAttempts || 0) + 1;
    try {
      await ExperimentModel.findByIdAndUpdate(experiment._id, {
        $set: {
          rslSnapshotStatus: snapshotComplete ? 'COMPLETE' : 'PENDING',
          rslSnapshotCompletedCount: completedCount,
          rslSnapshotLastAttemptAt: new Date(now),
          rslSnapshotLastErrorCode: 'FINALIZATION_STATE_UPDATE_FAILED',
          rslSnapshotAttempts: snapshotAttempts,
          rslSnapshotNextAttemptAt: new Date(now + backoffMs(snapshotAttempts - 1)),
          rslSnapshotLeaseUntil: null,
          rslSnapshotLeaseOwner: null,
          finalizationStatus: 'PENDING',
          finalizationClosedSessionCount: sessionVerification.closedCount,
          finalizationLastAttemptAt: new Date(now),
          finalizationLastErrorCode: 'FINALIZATION_STATE_UPDATE_FAILED',
          finalizationAttempts,
          finalizationNextAttemptAt: new Date(now + backoffMs(finalizationAttempts - 1)),
        },
      });
    } catch (retryErr) {
      console.error(
        `[rsl-recovery] gagal menjadwalkan ulang finalisasi ${experiment._id}: ${retryErr.message}`
      );
    }
  }

  return baseResult(finalizationComplete && !stateUpdateFailed ? 'complete' : 'pending', {
    snapshotsCreated,
    snapshotsAlreadyPresent,
    snapshotsUnavailable,
    experimentsCompleted: snapshotComplete && !stateUpdateFailed ? 1 : 0,
    experimentsFinalized: finalizationComplete && !stateUpdateFailed ? 1 : 0,
    sessionsClosed,
    finalizationStatus: finalizationComplete && !stateUpdateFailed ? 'COMPLETE' : 'PENDING',
    finalizationClosedSessionCount: sessionVerification.closedCount,
    retriesScheduled: finalizationComplete && !stateUpdateFailed ? 0 : 1,
    failures: failures.length + allFailures.length,
    errorCode: finalizationErrorCode,
    errors: allFailures,
    snapshots: snapshotVerification.snapshots,
  });
}

/**
 * Process a bounded batch of pending experiments. Returns an operational summary.
 */
async function runOnce({ now = Date.now(), maxBatch = DEFAULT_MAX_BATCH, deps = {} } = {}) {
  const ExperimentModel = deps.models?.Experiment || Experiment;
  const summary = {
    experimentsScanned: 0,
    experimentsPending: 0,
    snapshotsCreated: 0,
    snapshotsAlreadyPresent: 0,
    snapshotsUnavailable: 0,
    experimentsCompleted: 0,
    experimentsFinalized: 0,
    sessionsClosed: 0,
    retriesScheduled: 0,
    failures: 0,
    skippedLegacy: 0,
  };
  const limit = Math.max(1, Math.min(Number(maxBatch) || DEFAULT_MAX_BATCH, 50));
  for (let i = 0; i < limit; i += 1) {
    const experiment = await claimNext({ now, ExperimentModel });
    if (!experiment) break;
    summary.experimentsScanned += 1;
    let result;
    try {
      result = await reconcileExperiment(experiment, { ...deps, now });
    } catch (err) {
      summary.failures += 1;
      console.error(`[rsl-recovery] experiment ${experiment._id} gagal: ${err.message}`);
      continue;
    }
    summary.snapshotsCreated += result.snapshotsCreated;
    summary.snapshotsAlreadyPresent += result.snapshotsAlreadyPresent;
    summary.snapshotsUnavailable += result.snapshotsUnavailable;
    summary.experimentsCompleted += result.experimentsCompleted;
    summary.experimentsFinalized += result.experimentsFinalized;
    summary.sessionsClosed += result.sessionsClosed;
    summary.retriesScheduled += result.retriesScheduled;
    summary.failures += result.failures;
    if (result.status === 'pending') summary.experimentsPending += 1;
    if (result.status === 'skipped_legacy') summary.skippedLegacy += 1;
  }
  return summary;
}

let timer = null;
let startupTimer = null;
let running = false;
let lastSummary = null;
let lastRunAt = null;

function start() {
  if (timer) return;
  const every = Math.max(15, Number(env.rslSnapshotRecovery?.intervalSec) || 60) * 1000;
  const maxBatch = env.rslSnapshotRecovery?.maxBatch || DEFAULT_MAX_BATCH;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      lastSummary = await runOnce({ maxBatch });
      lastRunAt = new Date();
      if (
        lastSummary.experimentsScanned ||
        lastSummary.snapshotsCreated ||
        lastSummary.failures
      ) {
        console.log('[rsl-recovery]', JSON.stringify(lastSummary));
      }
    } catch (err) {
      console.error(`[rsl-recovery] pemeriksaan gagal: ${err.message}`);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, every);
  startupTimer = setTimeout(tick, 10_000);
  console.log(`[rsl-recovery] worker aktif (tiap ${every / 1000} detik)`);
}

function stop() {
  if (timer) clearInterval(timer);
  if (startupTimer) clearTimeout(startupTimer);
  timer = null;
  startupTimer = null;
}

function status() {
  return { running, lastRunAt, lastSummary };
}

module.exports = {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  DEFAULT_MAX_BATCH,
  LEASE_MS,
  backoffMs,
  captureSnapshot,
  claimNext,
  listForChamber,
  reconcileExperiment,
  runOnce,
  start,
  status,
  stop,
  verifyFinalization: (args) => {
    const snapshots = args.snapshotVerification;
    const sessions = args.sessionVerification;
    return Boolean(snapshots?.complete && sessions?.complete);
  },
  verifySessions,
  verifySnapshots,
};
