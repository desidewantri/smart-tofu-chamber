const test = require('node:test');
const assert = require('node:assert/strict');

const experimentService = require('../src/services/experimentService');
const { ingestReading } = require('../src/services/ingestService');
const recovery = require('../src/services/rslSnapshotService');
const rslService = require('../src/services/rslService');
const { createMemoryStore } = require('./helpers/memoryStore');

const SETTINGS = { zones: { segarHours: 24, rawanHours: 8 }, updateIntervalMinutes: 5 };
const LOWER = 3.068924444444445;
const UPPER = 22.888799999999996;

function estimatorFor(overrides = {}) {
  return {
    async estimateForSession({ session }) {
      if (overrides.throwForChamber === session.chamberId) {
        throw new Error('simulated RSL timeout');
      }
      if (overrides.unavailable) {
        return {
          status: 'UNAVAILABLE',
          reason: overrides.unavailable,
          message: `unavailable: ${overrides.unavailable}`,
          sampleStatus: session.sampleStatus || 'UNKNOWN',
          storageCondition: session.storageCondition || 'DRY',
          elapsedHours: 20.123456789,
          primary: null,
          supporting: null,
          metadata: { engineVersion: '1.0.0' },
        };
      }
      return {
        status: 'AVAILABLE',
        reason: null,
        message: null,
        sampleStatus: session.sampleStatus,
        storageCondition: session.storageCondition || 'DRY',
        elapsedHours: 20.123456789,
        primary: {
          method: 'M1',
          lowerHours: LOWER,
          upperHours: UPPER,
          display: { lowerHours: 3, upperHours: 23 },
          interpretation: 'EMPIRICAL_INTERVAL_ENVELOPE',
        },
        supporting: {
          M2: { method: 'M2_TURNBULL_NPMLE', components: [{ lowerHours: 0, upperHours: 1, mass: 0.5 }] },
          M3: { method: 'M3_WEIBULL_A0', r10Hours: 1.5, r90Hours: 9.5 },
        },
        metadata: {
          engineVersion: '1.0.0',
          referenceVersion: 'v2.3-frozen-2026-11-04',
          referencePopulation: 3,
          referenceStorageCondition: 'DRY',
          elapsedOrigin: 'EXPERIMENT_STARTED_AT',
        },
      };
    },
  };
}

async function startedStore() {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const { experiment, sessions } = await experimentService.startExperiment(
    { label: 'Snapshot test', storageCondition: 'DRY' },
    { models: store.models, settings: SETTINGS }
  );
  experiment.startedAt = new Date(Date.now() - 20.123456789 * 3600000);
  for (const session of store.state.sessions) {
    session.sampleStatus = 'NOT_SPOILED';
    session.storageCondition = 'DRY';
    session.sampleStatusUpdatedAt = new Date('2026-11-05T00:00:00Z');
    session.readingCount = 2;
  }
  return { store, experiment, sessions };
}

test('stop creates two final snapshots with full precision and one shared timestamp', async () => {
  const { store, experiment } = await startedStore();
  for (const session of store.state.sessions) {
    await store.models.SensorReading.create({
      chamberId: session.chamberId,
      sesiId: session._id,
      tvoc: 90,
      suhu: 30,
      rh: 66,
      timestamp: new Date('2026-11-05T10:00:00Z'),
      timestampQuality: 'OK',
      source: 'mqtt',
    });
  }
  const result = await experimentService.stopExperiment(experiment._id, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: estimatorFor(),
  });

  assert.equal(result.alreadyStopped, false);
  assert.equal(result.experiment.rslSnapshotStatus, 'COMPLETE');
  assert.equal(result.experiment.rslSnapshotCompletedCount, 2);
  assert.equal(result.experiment.finalizationStatus, 'COMPLETE');
  assert.equal(result.experiment.finalizationClosedSessionCount, 2);
  assert.equal(result.snapshots.length, 2);
  assert.equal(store.state.rslSnapshots.length, 2);
  const at = new Date(result.experiment.endedAt).getTime();
  for (const snap of result.snapshots) {
    assert.equal(new Date(snap.snapshotAt).getTime(), at);
    assert.equal(new Date(snap.endedAt).getTime(), at);
    assert.equal(snap.status, 'AVAILABLE');
    assert.equal(snap.primary.lowerHours, LOWER);
    assert.equal(snap.primary.upperHours, UPPER);
    assert.deepEqual(snap.primary.display, { lowerHours: 3, upperHours: 23 });
    assert.equal(snap.metadata.referencePopulation, 3);
    assert.equal(snap.sampleStatus, 'NOT_SPOILED');
    assert.ok(Math.abs(snap.elapsedHours - 20.123456789) < 0.01);
    assert.equal(snap.timestampQuality, 'OK');
    assert.ok(snap.lastReadingAt);
  }
  assert.deepEqual(result.snapshots.map((s) => s.chamberId).sort(), [1, 2]);
});

test('repeated stop returns existing snapshots without recalculating or replacing them', async () => {
  const { store, experiment } = await startedStore();
  const first = await experimentService.stopExperiment(experiment._id, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: estimatorFor(),
  });
  const firstValues = first.snapshots.map((s) => [s.chamberId, s.primary.lowerHours, s.primary.upperHours]);
  const creates = store.state.calls.snapshotCreates;

  const second = await experimentService.stopExperiment(experiment._id, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: {
      async estimateForSession() {
        throw new Error('must not be called on repeated stop');
      },
    },
  });

  assert.equal(second.alreadyStopped, true);
  assert.equal(store.state.rslSnapshots.length, 2);
  assert.equal(store.state.calls.snapshotCreates, creates);
  assert.deepEqual(
    second.snapshots.map((s) => [s.chamberId, s.primary.lowerHours, s.primary.upperHours]),
    firstValues
  );
});

test('UNKNOWN, SPOILED, and unsupported storage persist explicit unavailable snapshots', async () => {
  const cases = [
    ['UNKNOWN', 'SAMPLE_STATUS_UNKNOWN'],
    ['SPOILED', 'SAMPLE_REPORTED_SPOILED'],
  ];
  for (const [sampleStatus, reason] of cases) {
    const { store, experiment } = await startedStore();
    for (const session of store.state.sessions) session.sampleStatus = sampleStatus;
    const result = await experimentService.stopExperiment(experiment._id, {
      models: store.models,
      settings: SETTINGS,
      rslEstimator: estimatorFor({ unavailable: reason }),
    });
    assert.equal(result.snapshots.length, 2);
    assert.equal(result.experiment.rslSnapshotStatus, 'COMPLETE');
    assert.equal(result.experiment.rslSnapshotCompletedCount, 2);
    assert.equal(result.experiment.finalizationStatus, 'COMPLETE');
    for (const snap of result.snapshots) {
      assert.equal(snap.status, 'UNAVAILABLE');
      assert.equal(snap.reason, reason);
      assert.equal(snap.primary, null);
    }
  }

  const { store, experiment } = await startedStore();
  for (const session of store.state.sessions) session.storageCondition = 'WATER';
  const result = await experimentService.stopExperiment(experiment._id, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: estimatorFor({ unavailable: 'UNSUPPORTED_STORAGE_CONDITION' }),
  });
  for (const snap of result.snapshots) {
    assert.equal(snap.status, 'UNAVAILABLE');
    assert.equal(snap.reason, 'UNSUPPORTED_STORAGE_CONDITION');
    assert.equal(snap.primary, null);
  }
  assert.equal(result.experiment.rslSnapshotStatus, 'COMPLETE');
  assert.equal(result.experiment.finalizationStatus, 'COMPLETE');
});

test('outside support and engine timeout are explicit and do not fabricate values', async () => {
  const outsideStore = await startedStore();
  const outside = await experimentService.stopExperiment(outsideStore.experiment._id, {
    models: outsideStore.store.models,
    settings: SETTINGS,
    rslEstimator: estimatorFor({ unavailable: 'OUTSIDE_REFERENCE_SUPPORT' }),
  });
  for (const snap of outside.snapshots) {
    assert.equal(snap.status, 'UNAVAILABLE');
    assert.equal(snap.reason, 'OUTSIDE_REFERENCE_SUPPORT');
    assert.equal(snap.primary, null);
  }

  const timeoutStore = await startedStore();
  const timedOut = await experimentService.stopExperiment(timeoutStore.experiment._id, {
    models: timeoutStore.store.models,
    settings: SETTINGS,
    rslEstimator: estimatorFor({ throwForChamber: 1 }),
  });
  assert.equal(timedOut.experiment.status, 'selesai');
  assert.equal(timedOut.snapshots.length, 1);
  assert.equal(timedOut.snapshotErrors.length, 1);
  assert.equal(timedOut.snapshotErrors[0].chamberId, 1);
  assert.equal(timeoutStore.store.state.rslSnapshots.length, 1);
  assert.equal(timeoutStore.store.state.rslSnapshots[0].chamberId, 2);
});

test('snapshot persistence failure never prevents safe experiment closure', async () => {
  const { store, experiment } = await startedStore();
  const original = store.models.RslSnapshot.findOneAndUpdate;
  store.models.RslSnapshot.findOneAndUpdate = async () => {
    throw new Error('snapshot database unavailable');
  };
  const result = await experimentService.stopExperiment(experiment._id, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: estimatorFor(),
  });
  assert.equal(result.experiment.status, 'selesai');
  assert.equal(result.experiment.rslSnapshotStatus, 'PENDING');
  assert.equal(result.experiment.rslSnapshotCompletedCount, 0);
  assert.equal(result.experiment.finalizationStatus, 'PENDING');
  assert.equal(result.snapshots.length, 0);
  assert.equal(result.snapshotErrors.length, 2);
  assert.equal(store.state.experiments[0].status, 'selesai');
  assert.ok(store.state.experiments[0].endedAt);
  store.models.RslSnapshot.findOneAndUpdate = original;
});

test('one chamber insert failure remains PENDING and recovery fills only the missing chamber', async () => {
  const { store, experiment } = await startedStore();
  const original = store.models.RslSnapshot.findOneAndUpdate;
  store.models.RslSnapshot.findOneAndUpdate = async (filter, update, options) => {
    if (filter.chamberId === 2) throw new Error('chamber 2 insert failed');
    return original(filter, update, options);
  };
  const first = await experimentService.stopExperiment(experiment._id, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: estimatorFor(),
  });
  assert.equal(first.experiment.rslSnapshotStatus, 'PENDING');
  assert.equal(first.experiment.rslSnapshotCompletedCount, 1);
  assert.equal(first.experiment.finalizationStatus, 'PENDING');
  assert.equal(first.snapshots.length, 1);
  assert.equal(first.snapshots[0].chamberId, 1);
  const originalLower = first.snapshots[0].primary.lowerHours;
  const endedAt = new Date(first.experiment.endedAt).getTime();

  store.models.RslSnapshot.findOneAndUpdate = original;
  const recovered = await recovery.reconcileExperiment(first.experiment, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: estimatorFor(),
    now: endedAt + 60_000,
  });
  assert.equal(recovered.status, 'complete');
  assert.equal(store.state.rslSnapshots.length, 2);
  assert.equal(store.state.experiments[0].rslSnapshotStatus, 'COMPLETE');
  assert.equal(store.state.experiments[0].rslSnapshotCompletedCount, 2);
  assert.equal(store.state.experiments[0].finalizationStatus, 'COMPLETE');
  assert.equal(new Date(store.state.experiments[0].endedAt).getTime(), endedAt);
  assert.equal(
    store.state.rslSnapshots.find((s) => s.chamberId === 1).primary.lowerHours,
    originalLower
  );
});

test('experiment closure persistence failure returns an error and does not claim stopped', async () => {
  const { store, experiment } = await startedStore();
  const original = store.models.Experiment.findOneAndUpdate;
  store.models.Experiment.findOneAndUpdate = async () => null;
  await assert.rejects(
    () =>
      experimentService.stopExperiment(experiment._id, {
        models: store.models,
        settings: SETTINGS,
        rslEstimator: estimatorFor(),
      }),
    (err) => err.status === 500 && err.details?.code === 'EXPERIMENT_CLOSURE_FAILED'
  );
  assert.equal(store.state.experiments[0].status, 'aktif');
  assert.equal(store.state.rslSnapshots.length, 0);
  store.models.Experiment.findOneAndUpdate = original;
});


test('one chamber session closure failure leaves finalization PENDING and recovery closes only it', async () => {
  const { store, experiment } = await startedStore();
  const original = store.models.Session.findByIdAndUpdate;
  store.models.Session.findByIdAndUpdate = async (id, update, options) => {
    const session = store.state.sessions.find((s) => s._id === id);
    if (session?.chamberId === 2) throw new Error('session 2 closure failed');
    return original(id, update, options);
  };
  const first = await experimentService.stopExperiment(experiment._id, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: estimatorFor(),
  });
  assert.equal(first.experiment.status, 'selesai');
  assert.equal(first.experiment.rslSnapshotStatus, 'COMPLETE');
  assert.equal(first.experiment.finalizationStatus, 'PENDING');
  assert.equal(first.experiment.finalizationClosedSessionCount, 1);
  assert.equal(first.snapshots.length, 2);
  assert.equal(first.finalizationErrors.length >= 1, true);
  const chamber2 = store.state.sessions.find((s) => s.chamberId === 2);
  assert.equal(chamber2.status, 'aktif');
  const endedAt = new Date(first.experiment.endedAt).getTime();

  store.models.Session.findByIdAndUpdate = original;
  const recovered = await recovery.reconcileExperiment(first.experiment, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: estimatorFor(),
    now: endedAt + 60_000,
  });
  assert.equal(recovered.status, 'complete');
  assert.equal(store.state.experiments[0].finalizationStatus, 'COMPLETE');
  assert.equal(store.state.experiments[0].finalizationClosedSessionCount, 2);
  assert.equal(chamber2.status, 'selesai');
  assert.equal(new Date(chamber2.selesai).getTime(), endedAt);
  assert.equal(store.state.rslSnapshots.length, 2);
});

test('both session closure failures leave finalization PENDING with two snapshots', async () => {
  const { store, experiment } = await startedStore();
  const original = store.models.Session.findByIdAndUpdate;
  store.models.Session.findByIdAndUpdate = async () => {
    throw new Error('all session closures failed');
  };
  const first = await experimentService.stopExperiment(experiment._id, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: estimatorFor(),
  });
  assert.equal(first.experiment.rslSnapshotStatus, 'COMPLETE');
  assert.equal(first.experiment.finalizationStatus, 'PENDING');
  assert.equal(first.experiment.finalizationClosedSessionCount, 0);
  assert.equal(first.snapshots.length, 2);
  assert.equal(store.state.sessions.every((s) => s.status === 'aktif'), true);

  store.models.Session.findByIdAndUpdate = original;
  const endedAt = new Date(first.experiment.endedAt).getTime();
  const recovered = await recovery.reconcileExperiment(first.experiment, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: estimatorFor(),
    now: endedAt + 60_000,
  });
  assert.equal(recovered.status, 'complete');
  assert.equal(store.state.experiments[0].finalizationStatus, 'COMPLETE');
  assert.equal(store.state.sessions.every((s) => s.status === 'selesai'), true);
  assert.equal(store.state.rslSnapshots.length, 2);
});

test('a legitimately earlier closed session retains its original timestamp', async () => {
  const { store, experiment } = await startedStore();
  const earlier = new Date(experiment.startedAt.getTime() + 3600000);
  const session1 = store.state.sessions.find((s) => s.chamberId === 1);
  session1.status = 'selesai';
  session1.selesai = earlier;
  session1.statusAkhir = 'Segera Konsumsi';
  session1.sisaAkhirJam = 5;
  const result = await experimentService.stopExperiment(experiment._id, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: estimatorFor(),
  });
  assert.equal(result.experiment.finalizationStatus, 'COMPLETE');
  assert.equal(new Date(session1.selesai).getTime(), earlier.getTime());
  const snap1 = store.state.rslSnapshots.find((s) => s.chamberId === 1);
  assert.equal(new Date(snap1.snapshotAt).getTime(), new Date(result.experiment.endedAt).getTime());
});

test('missing chamber session keeps finalization PENDING without fabricated snapshots', async () => {
  const { store, experiment } = await startedStore();
  store.state.sessions = store.state.sessions.filter((s) => s.chamberId !== 2);
  const result = await experimentService.stopExperiment(experiment._id, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: estimatorFor(),
  });
  assert.equal(result.experiment.finalizationStatus, 'PENDING');
  assert.equal(result.experiment.finalizationLastErrorCode, 'AMBIGUOUS_SESSION_ASSOCIATION');
  assert.equal(result.snapshots.length, 0);
});


test('late MQTT is rejected when the experiment is closed even if a session is still active', async () => {
  const { store, experiment } = await startedStore();
  experiment.status = 'selesai';
  experiment.endedAt = new Date();
  // Leave the session active to simulate the Phase 10.1 compound failure.
  const result = await ingestReading(
    {
      sample_id: 'late-closed-experiment-1',
      event_id: 'late-closed-experiment-1-ch1',
      chamber_id: 1,
      tvoc: 90,
      suhu: 30,
      rh: 66,
      sampled_at: new Date().toISOString(),
    },
    { source: 'mqtt', receivedAt: new Date() },
    store
  ).then(() => null).catch((err) => err);
  assert.equal(result.status, 409);
  assert.equal(result.details?.code, 'NO_ACTIVE_EXPERIMENT');
  assert.equal(store.state.readings.length, 0);
});

test('sample status is rejected while finalization is pending even if experiment status is active', async () => {
  const { store, experiment } = await startedStore();
  experiment.finalizationStatus = 'PENDING';
  const session = store.state.sessions[0];
  await assert.rejects(
    () =>
      rslService.updateSampleStatus(
        {
          experimentId: experiment._id,
          sessionId: session._id,
          sampleStatus: 'SPOILED',
        },
        { models: store.models }
      ),
    (err) => err.status === 409 && err.details?.code === 'FINALIZATION_PENDING'
  );
  assert.equal(session.sampleStatus, 'NOT_SPOILED');
});

test('sample status cannot be changed after the session is closed', async () => {
  const { store, experiment } = await startedStore();
  await experimentService.stopExperiment(experiment._id, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: estimatorFor(),
  });
  const session = store.state.sessions[0];
  await assert.rejects(
    () =>
      rslService.updateSampleStatus(
        {
          experimentId: experiment._id,
          sessionId: session._id,
          sampleStatus: 'SPOILED',
        },
        { models: store.models }
      ),
    (err) => err.status === 409 && err.details?.code === 'EXPERIMENT_CLOSED'
  );
  assert.equal(session.sampleStatus, 'NOT_SPOILED');
});

test('old completed experiments without snapshots remain readable', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const old = {
    _id: 'old-exp',
    label: 'Old experiment',
    startedAt: new Date('2026-10-01T00:00:00Z'),
    endedAt: new Date('2026-10-02T00:00:00Z'),
    status: 'selesai',
    chamberIds: [1, 2],
  };
  store.state.experiments.push(old);
  const result = await experimentService.stopExperiment(old._id, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: estimatorFor(),
  });
  assert.equal(result.alreadyStopped, true);
  assert.deepEqual(result.snapshots, []);
  assert.equal(store.state.rslSnapshots.length, 0);
});
