const test = require('node:test');
const assert = require('node:assert/strict');

const experimentService = require('../src/services/experimentService');
const recovery = require('../src/services/rslSnapshotService');
const { createMemoryStore } = require('./helpers/memoryStore');

const SETTINGS = { zones: { segarHours: 24, rawanHours: 8 }, updateIntervalMinutes: 5 };
const STARTED = new Date('2026-11-05T00:00:00.000Z');
const ENDED = new Date('2026-11-05T20:00:00.000Z');
const LOWER = 3.068924444444445;
const UPPER = 22.888799999999996;

function estimator({ unavailable = false, calls = [], throwChamber = null } = {}) {
  return {
    async estimateForSession({ session }) {
      calls.push(session.chamberId);
      if (throwChamber === session.chamberId) throw new Error('RSL unavailable');
      if (unavailable) {
        return {
          status: 'UNAVAILABLE',
          reason: 'RSL_UNAVAILABLE',
          message: 'RSL service unavailable',
          sampleStatus: session.sampleStatus,
          storageCondition: session.storageCondition,
          elapsedHours: 20,
          primary: null,
          supporting: null,
          metadata: { engineVersion: 'test' },
        };
      }
      return {
        status: 'AVAILABLE',
        reason: null,
        sampleStatus: session.sampleStatus,
        storageCondition: session.storageCondition,
        elapsedHours: 20,
        primary: {
          method: 'M1',
          lowerHours: LOWER,
          upperHours: UPPER,
          display: { lowerHours: 3, upperHours: 23 },
        },
        supporting: { M2: {}, M3: {} },
        metadata: { engineVersion: 'test', referencePopulation: 3 },
      };
    },
  };
}

async function closedStore({ snapshotChambers = [], status = 'PENDING' } = {}) {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const { experiment, sessions } = await experimentService.startExperiment(
    { label: 'Recovery test', storageCondition: 'DRY' },
    { models: store.models, settings: SETTINGS }
  );
  experiment.startedAt = STARTED;
  experiment.endedAt = ENDED;
  experiment.status = 'selesai';
  experiment.rslSnapshotStatus = status;
  experiment.rslSnapshotExpectedCount = 2;
  experiment.rslSnapshotCompletedCount = snapshotChambers.length;
  if (status) {
    experiment.finalizationStatus = status;
    experiment.finalizationExpectedSessionCount = 2;
    experiment.finalizationClosedSessionCount = 2;
  }
  for (const session of store.state.sessions) {
    session.status = 'selesai';
    session.selesai = ENDED;
    session.masuk = STARTED;
    session.sampleStatus = 'NOT_SPOILED';
    session.storageCondition = 'DRY';
    session.readingCount = 1;
  }
  for (const chamberId of snapshotChambers) {
    const session = store.state.sessions.find((s) => s.chamberId === chamberId);
    await store.models.RslSnapshot.findOneAndUpdate(
      { experimentId: experiment._id, chamberId },
      {
        $setOnInsert: {
          experimentId: experiment._id,
          sessionId: session._id,
          chamberId,
          snapshotAt: ENDED,
          endedAt: ENDED,
          status: 'AVAILABLE',
          sampleStatus: 'NOT_SPOILED',
          storageCondition: 'DRY',
          primary: { lowerHours: 99, upperHours: 100, display: { lowerHours: 99, upperHours: 100 } },
        },
      }
    );
  }
  return { store, experiment, sessions };
}

function deps(store, est, extra = {}) {
  return {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: est,
    ...extra,
  };
}

test('runOnce recovers both missing snapshots and marks COMPLETE', async () => {
  const { store, experiment } = await closedStore();
  const summary = await recovery.runOnce({
    now: ENDED.getTime() + 1000,
    maxBatch: 5,
    deps: deps(store, estimator()),
  });
  assert.equal(summary.experimentsScanned, 1);
  assert.equal(summary.snapshotsCreated, 2);
  assert.equal(summary.experimentsCompleted, 1);
  assert.equal(store.state.rslSnapshots.length, 2);
  assert.equal(store.state.experiments[0].rslSnapshotStatus, 'COMPLETE');
  assert.equal(store.state.experiments[0].rslSnapshotCompletedCount, 2);
  assert.equal(store.state.experiments[0].rslSnapshotRecoveredAt instanceof Date, true);
  for (const snap of store.state.rslSnapshots) {
    assert.equal(new Date(snap.snapshotAt).getTime(), ENDED.getTime());
    assert.equal(snap.primary.lowerHours, LOWER);
  }
});

test('missing Chamber 1 or Chamber 2 snapshot is recovered independently', async () => {
  for (const existing of [1, 2]) {
    const { store, experiment } = await closedStore({ snapshotChambers: [existing] });
    const calls = [];
    const summary = await recovery.runOnce({
      now: ENDED.getTime() + 1000,
      deps: deps(store, estimator({ calls })),
    });
    assert.equal(summary.snapshotsCreated, 1, `existing ${existing}`);
    assert.deepEqual(calls, [existing === 1 ? 2 : 1]);
    assert.equal(store.state.rslSnapshots.length, 2);
    assert.equal(store.state.experiments[0].rslSnapshotStatus, 'COMPLETE');
  }
});

test('existing canonical snapshot is never recalculated or overwritten', async () => {
  const { store, experiment } = await closedStore({ snapshotChambers: [1] });
  const before = store.state.rslSnapshots.find((s) => s.chamberId === 1).primary.lowerHours;
  const calls = [];
  await recovery.runOnce({
    now: ENDED.getTime() + 1000,
    deps: deps(store, estimator({ calls })),
  });
  const after = store.state.rslSnapshots.find((s) => s.chamberId === 1).primary.lowerHours;
  assert.equal(before, 99);
  assert.equal(after, 99);
  assert.deepEqual(calls, [2]);
});

test('already-complete experiments are skipped', async () => {
  const { store } = await closedStore({ snapshotChambers: [1, 2], status: 'COMPLETE' });
  const summary = await recovery.runOnce({
    now: ENDED.getTime() + 1000,
    deps: deps(store, estimator()),
  });
  assert.equal(summary.experimentsScanned, 0);
  assert.equal(store.state.rslSnapshots.length, 2);
});

test('RSL outage persists explicit unavailable snapshots and still completes', async () => {
  const { store } = await closedStore();
  const summary = await recovery.runOnce({
    now: ENDED.getTime() + 1000,
    deps: deps(store, estimator({ unavailable: true })),
  });
  assert.equal(summary.snapshotsCreated, 2);
  assert.equal(summary.snapshotsUnavailable, 2);
  assert.equal(summary.experimentsCompleted, 1);
  assert.equal(store.state.experiments[0].rslSnapshotStatus, 'COMPLETE');
  for (const snap of store.state.rslSnapshots) {
    assert.equal(snap.status, 'UNAVAILABLE');
    assert.equal(snap.reason, 'RSL_UNAVAILABLE');
    assert.equal(snap.primary, null);
  }
});

test('partial insert failure remains PENDING and is recoverable without overwriting', async () => {
  const { store } = await closedStore();
  const original = store.models.RslSnapshot.findOneAndUpdate;
  store.models.RslSnapshot.findOneAndUpdate = async (filter, update, options) => {
    if (filter.chamberId === 2) throw new Error('simulated insert failure');
    return original(filter, update, options);
  };
  const first = await recovery.runOnce({
    now: ENDED.getTime() + 1000,
    deps: deps(store, estimator()),
  });
  assert.equal(first.experimentsPending, 1);
  assert.equal(store.state.rslSnapshots.length, 1);
  assert.equal(store.state.experiments[0].rslSnapshotStatus, 'PENDING');
  assert.equal(store.state.experiments[0].rslSnapshotCompletedCount, 1);
  assert.equal(new Date(store.state.experiments[0].endedAt).getTime(), ENDED.getTime());

  store.models.RslSnapshot.findOneAndUpdate = original;
  const second = await recovery.runOnce({
    now: new Date(store.state.experiments[0].rslSnapshotNextAttemptAt).getTime() + 1,
    deps: deps(store, estimator()),
  });
  assert.equal(second.experimentsCompleted, 1);
  assert.equal(store.state.rslSnapshots.length, 2);
  assert.equal(store.state.experiments[0].rslSnapshotStatus, 'COMPLETE');
});

test('both snapshots exist but completion-state update failure is healed later', async () => {
  const { store } = await closedStore();
  const original = store.models.Experiment.findByIdAndUpdate;
  let failedOnce = false;
  store.models.Experiment.findByIdAndUpdate = async (id, update, options) => {
    if (!failedOnce && update.$set?.rslSnapshotStatus === 'COMPLETE') {
      failedOnce = true;
      throw new Error('completion state write failed');
    }
    return original(id, update, options);
  };
  const first = await recovery.runOnce({
    now: ENDED.getTime() + 1000,
    deps: deps(store, estimator()),
  });
  assert.equal(store.state.rslSnapshots.length, 2);
  assert.equal(first.experimentsCompleted, 0);
  assert.equal(store.state.experiments[0].rslSnapshotStatus, 'COMPLETE');
  assert.equal(store.state.experiments[0].finalizationStatus, 'PENDING');

  store.models.Experiment.findByIdAndUpdate = original;
  const second = await recovery.runOnce({
    now: new Date(store.state.experiments[0].rslSnapshotNextAttemptAt).getTime() + 1,
    deps: deps(store, estimator()),
  });
  assert.equal(second.experimentsCompleted, 1);
  assert.equal(store.state.experiments[0].rslSnapshotStatus, 'COMPLETE');
  assert.equal(store.state.rslSnapshots.length, 2);
});

test('backoff prevents immediate tight retry and restart resumes later', async () => {
  const { store } = await closedStore();
  const original = store.models.RslSnapshot.findOneAndUpdate;
  store.models.RslSnapshot.findOneAndUpdate = async () => {
    throw new Error('database down');
  };
  const first = await recovery.runOnce({
    now: ENDED.getTime() + 1000,
    deps: deps(store, estimator()),
  });
  assert.equal(first.experimentsPending, 1);
  const next = new Date(store.state.experiments[0].rslSnapshotNextAttemptAt).getTime();
  assert.ok(next > ENDED.getTime() + 1000);
  const immediate = await recovery.runOnce({
    now: ENDED.getTime() + 2000,
    deps: deps(store, estimator()),
  });
  assert.equal(immediate.experimentsScanned, 0);
  store.models.RslSnapshot.findOneAndUpdate = original;
  const resumed = await recovery.runOnce({
    now: next + 1,
    deps: deps(store, estimator()),
  });
  assert.equal(resumed.experimentsCompleted, 1);
});

test('maximum batch size is respected', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  for (let i = 0; i < 3; i += 1) {
    const { experiment } = await experimentService.startExperiment(
      { label: `Batch ${i}`, storageCondition: 'DRY' },
      { models: store.models, settings: SETTINGS }
    );
    experiment.startedAt = STARTED;
    experiment.endedAt = ENDED;
    experiment.status = 'selesai';
    experiment.rslSnapshotStatus = 'PENDING';
    experiment.rslSnapshotExpectedCount = 2;
    experiment.rslSnapshotCompletedCount = 0;
    for (const session of store.state.sessions.filter((s) => s.experimentId === experiment._id)) {
      session.status = 'selesai';
      session.selesai = ENDED;
      session.sampleStatus = 'NOT_SPOILED';
      session.storageCondition = 'DRY';
    }
  }
  const summary = await recovery.runOnce({
    now: ENDED.getTime() + 1000,
    maxBatch: 2,
    deps: deps(store, estimator()),
  });
  assert.equal(summary.experimentsScanned, 2);
  assert.equal(store.state.experiments.filter((e) => e.rslSnapshotStatus === 'COMPLETE').length, 2);
});

test('concurrent workers do not create duplicate canonical snapshots', async () => {
  const { store } = await closedStore();
  await Promise.all([
    recovery.runOnce({ now: ENDED.getTime() + 1000, deps: deps(store, estimator()) }),
    recovery.runOnce({ now: ENDED.getTime() + 1000, deps: deps(store, estimator()) }),
  ]);
  assert.equal(store.state.rslSnapshots.length, 2);
  assert.equal(store.state.experiments[0].rslSnapshotStatus, 'COMPLETE');
});

test('recovery does not create notification events', async () => {
  const { store } = await closedStore();
  await recovery.runOnce({
    now: ENDED.getTime() + 1000,
    deps: deps(store, estimator()),
  });
  assert.equal(store.state.notificationEvents.length, 0);
});

test('ambiguous session associations are not given fabricated snapshots', async () => {
  const { store } = await closedStore();
  store.state.sessions = store.state.sessions.filter((s) => s.chamberId !== 2);
  const summary = await recovery.runOnce({
    now: ENDED.getTime() + 1000,
    deps: deps(store, estimator()),
  });
  assert.equal(summary.experimentsPending, 1);
  assert.equal(store.state.rslSnapshots.length, 0);
  assert.equal(store.state.experiments[0].rslSnapshotLastErrorCode, 'AMBIGUOUS_SESSION_ASSOCIATION');
});


function makeOrphan(store, chambers) {
  const experiment = store.state.experiments[0];
  experiment.rslSnapshotStatus = 'COMPLETE';
  experiment.rslSnapshotCompletedCount = 2;
  experiment.finalizationStatus = 'PENDING';
  experiment.finalizationExpectedSessionCount = 2;
  experiment.finalizationClosedSessionCount = 2 - chambers.length;
  for (const session of store.state.sessions) {
    if (chambers.includes(session.chamberId)) {
      session.status = 'aktif';
      session.selesai = null;
    }
  }
  return experiment;
}

test('closed experiment with one active orphan session is discovered and finalized', async () => {
  const { store } = await closedStore({ snapshotChambers: [1, 2], status: 'COMPLETE' });
  const experiment = makeOrphan(store, [2]);
  const before = store.state.rslSnapshots.map((s) => [s.chamberId, s.snapshotAt.toISOString()]);
  const summary = await recovery.runOnce({
    now: ENDED.getTime() + 1000,
    deps: deps(store, estimator()),
  });
  assert.equal(summary.experimentsScanned, 1);
  assert.equal(summary.sessionsClosed, 1);
  assert.equal(summary.experimentsFinalized, 1);
  assert.equal(store.state.experiments[0].finalizationStatus, 'COMPLETE');
  assert.equal(store.state.experiments[0].finalizationClosedSessionCount, 2);
  const chamber2 = store.state.sessions.find((s) => s.chamberId === 2);
  assert.equal(chamber2.status, 'selesai');
  assert.equal(new Date(chamber2.selesai).getTime(), ENDED.getTime());
  assert.deepEqual(
    store.state.rslSnapshots.map((s) => [s.chamberId, s.snapshotAt.toISOString()]),
    before
  );
});

test('closed experiment with two active orphan sessions is discovered and finalized', async () => {
  const { store } = await closedStore({ snapshotChambers: [1, 2], status: 'COMPLETE' });
  makeOrphan(store, [1, 2]);
  const summary = await recovery.runOnce({
    now: ENDED.getTime() + 1000,
    deps: deps(store, estimator()),
  });
  assert.equal(summary.sessionsClosed, 2);
  assert.equal(summary.experimentsFinalized, 1);
  assert.equal(store.state.sessions.every((s) => s.status === 'selesai'), true);
  assert.equal(store.state.rslSnapshots.length, 2);
});

test('worker closes only the orphan and preserves an earlier closed session timestamp', async () => {
  const { store } = await closedStore({ snapshotChambers: [1, 2], status: 'COMPLETE' });
  const experiment = makeOrphan(store, [2]);
  const earlier = new Date(ENDED.getTime() - 2 * 3600000);
  const chamber1 = store.state.sessions.find((s) => s.chamberId === 1);
  chamber1.selesai = earlier;
  await recovery.runOnce({
    now: ENDED.getTime() + 1000,
    deps: deps(store, estimator()),
  });
  assert.equal(new Date(chamber1.selesai).getTime(), earlier.getTime());
  assert.equal(experiment.finalizationStatus, 'COMPLETE');
});

test('session closure database failure remains retryable', async () => {
  const { store } = await closedStore({ snapshotChambers: [1, 2], status: 'COMPLETE' });
  makeOrphan(store, [2]);
  const original = store.models.Session.findByIdAndUpdate;
  store.models.Session.findByIdAndUpdate = async () => {
    throw new Error('session database down');
  };
  const first = await recovery.runOnce({
    now: ENDED.getTime() + 1000,
    deps: deps(store, estimator()),
  });
  assert.equal(first.experimentsPending, 1);
  assert.equal(store.state.experiments[0].finalizationStatus, 'PENDING');
  const next = new Date(store.state.experiments[0].finalizationNextAttemptAt).getTime();
  assert.ok(next > ENDED.getTime() + 1000);
  store.models.Session.findByIdAndUpdate = original;
  const second = await recovery.runOnce({
    now: next + 1,
    deps: deps(store, estimator()),
  });
  assert.equal(second.experimentsFinalized, 1);
  assert.equal(store.state.experiments[0].finalizationStatus, 'COMPLETE');
});

test('one experiment failure does not abort the reconciliation batch', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const first = await closedStore();
  // Use the first store's experiment in this store would complicate ids; create
  // two independent closed experiments in one store instead.
  for (let i = 0; i < 2; i += 1) {
    const { experiment } = await experimentService.startExperiment(
      { label: `Batch isolation ${i}`, storageCondition: 'DRY' },
      { models: store.models, settings: SETTINGS }
    );
    experiment.startedAt = STARTED;
    experiment.endedAt = ENDED;
    experiment.status = 'selesai';
    experiment.rslSnapshotStatus = 'PENDING';
    experiment.rslSnapshotExpectedCount = 2;
    experiment.rslSnapshotCompletedCount = 0;
    experiment.finalizationStatus = 'PENDING';
    experiment.finalizationExpectedSessionCount = 2;
    experiment.finalizationClosedSessionCount = 2;
    for (const session of store.state.sessions.filter((s) => s.experimentId === experiment._id)) {
      session.status = 'selesai';
      session.selesai = ENDED;
      session.sampleStatus = 'NOT_SPOILED';
      session.storageCondition = 'DRY';
    }
  }
  const originalFind = store.models.Session.find;
  let thrown = false;
  store.models.Session.find = (filter = {}) => {
    if (!thrown && filter.experimentId === store.state.experiments[0]._id) {
      thrown = true;
      throw new Error('first experiment session lookup failed');
    }
    return originalFind(filter);
  };
  const summary = await recovery.runOnce({
    now: ENDED.getTime() + 1000,
    maxBatch: 5,
    deps: deps(store, estimator()),
  });
  store.models.Session.find = originalFind;
  assert.equal(summary.failures, 1);
  assert.equal(summary.experimentsFinalized, 1);
  assert.equal(
    store.state.experiments.filter((e) => e.finalizationStatus === 'COMPLETE').length,
    1
  );
});

test('legacy Phase 10 experiment with one snapshot is reconciled safely', async () => {
  const { store } = await closedStore({ snapshotChambers: [1], status: undefined });
  const summary = await recovery.runOnce({
    now: ENDED.getTime() + 1000,
    deps: deps(store, estimator()),
  });
  assert.equal(summary.snapshotsCreated, 1);
  assert.equal(store.state.rslSnapshots.length, 2);
  assert.equal(store.state.experiments[0].rslSnapshotStatus, 'COMPLETE');
  assert.equal(store.state.rslSnapshots.find((s) => s.chamberId === 1).primary.lowerHours, 99);
});

test('legacy closed experiments with no lifecycle fields and no snapshots are skipped', async () => {
  const { store } = await closedStore();
  store.state.experiments[0].rslSnapshotStatus = undefined;
  store.state.experiments[0].rslSnapshotCompletedCount = 0;
  const summary = await recovery.runOnce({
    now: ENDED.getTime() + 1000,
    deps: deps(store, estimator()),
  });
  assert.equal(summary.skippedLegacy, 1);
  assert.equal(store.state.rslSnapshots.length, 0);
});
