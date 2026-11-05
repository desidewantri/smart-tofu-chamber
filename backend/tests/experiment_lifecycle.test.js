const test = require('node:test');
const assert = require('node:assert/strict');

const { ingestReading } = require('../src/services/ingestService');
const experimentService = require('../src/services/experimentService');
const { sessionView } = require('../src/utils/presenters');
const { createMemoryStore } = require('./helpers/memoryStore');

const ZONES = { segarHours: 24, rawanHours: 8 };
const SETTINGS = { zones: ZONES, updateIntervalMinutes: 5 };
const RSL_ESTIMATOR = {
  async estimateForSession({ session }) {
    return {
      status: 'UNAVAILABLE',
      reason: session.sampleStatus === 'SPOILED' ? 'SAMPLE_REPORTED_SPOILED' : 'SAMPLE_STATUS_UNKNOWN',
      message: 'status not supplied in lifecycle fixture',
      sampleStatus: session.sampleStatus || 'UNKNOWN',
      storageCondition: session.storageCondition || 'DRY',
      elapsedHours: 1,
      primary: null,
      supporting: null,
      metadata: { engineVersion: 'test' },
    };
  },
};
let sequence = 0;

function payload(chamber, sampledAt, overrides = {}) {
  sequence += 1;
  return {
    sample_id: `test-cycle-${sequence}-1`,
    device_id: 'test-device',
    chamber_id: chamber,
    tvoc: 100 + sequence,
    suhu: 27.5,
    rh: 79,
    sampled_at: sampledAt.toISOString(),
    ...overrides,
  };
}

async function start(store, label = 'Test experiment') {
  return experimentService.startExperiment(
    { label },
    { models: store.models, settings: SETTINGS }
  );
}

function ingest(store, p, source = 'mqtt') {
  // Tests use deterministic sample times, including times ahead of the wall
  // clock. Treat the sample as received one second after it was taken so the
  // 15-minute future-skew guard does not rewrite the test clock.
  const sampled = p.sampled_at ? new Date(p.sampled_at) : new Date();
  const receivedAt = new Date(sampled.getTime() + 1000);
  return ingestReading(p, { source, receivedAt }, store);
}

test('start creates exactly one experiment and two linked chamber sessions', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const { experiment, sessions } = await start(store);

  assert.equal(store.state.experiments.length, 1);
  assert.equal(store.state.sessions.length, 2);
  assert.equal(experiment.status, 'aktif');
  assert.ok(experiment.startedAt instanceof Date);
  assert.deepEqual(experiment.chamberIds, [1, 2]);

  for (const s of sessions) {
    assert.equal(String(s.experimentId), String(experiment._id));
    assert.equal(s.status, 'aktif');
    assert.equal(s.masuk, null);
    assert.equal(s.tvoc_awal, null);
    assert.equal(s.suhu_awal, null);
    assert.equal(s.rh_awal, null);
  }
  assert.deepEqual(sessions.map((s) => s.chamberId).sort(), [1, 2]);
});

test('both sessions share the same experiment startpoint', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const { experiment, sessions } = await start(store);
  for (const s of sessions) {
    assert.equal(String(s.experimentId), String(experiment._id));
  }
  assert.equal(new Date(experiment.startedAt).getTime(), experiment.startedAt.getTime());
  assert.equal(sessions[0].masuk, null);
  assert.equal(sessions[1].masuk, null);
});

test('start rejects a legacy active session with 409 and preserves it', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const legacy = {
    _id: 'legacy-session-1',
    seq: 1,
    sesiCode: 'CH-009',
    chamberId: 1,
    status: 'aktif',
    masuk: new Date('2026-10-27T02:25:19.000Z'),
    experimentId: null,
  };
  store.state.sessions.push(legacy);

  await assert.rejects(
    () => start(store),
    (err) => err.status === 409 && err.details?.code === 'LEGACY_ACTIVE_SESSION'
  );

  assert.equal(store.state.experiments.length, 0);
  assert.equal(store.state.sessions.length, 1);
  assert.equal(store.state.sessions[0]._id, 'legacy-session-1');
  assert.equal(store.state.sessions[0].status, 'aktif');
});

test('a second experiment start is rejected while one is active', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  await start(store);
  await assert.rejects(
    () => start(store, 'Second'),
    (err) => err.status === 409 && err.details?.code === 'ACTIVE_EXPERIMENT_EXISTS'
  );
  assert.equal(store.state.experiments.length, 1);
  assert.equal(store.state.sessions.length, 2);
});

test('concurrent experiment starts produce one experiment and two sessions', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const results = await Promise.allSettled([start(store), start(store)]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.status, 409);
  assert.equal(store.state.experiments.length, 1);
  assert.equal(store.state.sessions.length, 2);
});

test('partial session failure cleans up the new experiment and sessions', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const original = store.models.Session.create;
  let calls = 0;
  store.models.Session.create = async (doc) => {
    calls += 1;
    if (calls === 2) throw new Error('simulated session failure');
    return original(doc);
  };

  await assert.rejects(() => start(store), /simulated session failure/);
  assert.equal(store.state.experiments.length, 0);
  assert.equal(store.state.sessions.length, 0);
});

test('start rejects a disabled participating chamber', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  store.state.chambers.push({
    chamberId: 1,
    code: 'CHAMBER-1',
    name: 'Chamber 1',
    enabled: false,
  });
  await assert.rejects(
    () => start(store),
    (err) => err.status === 409 && err.details?.code === 'CHAMBER_DISABLED'
  );
  assert.equal(store.state.experiments.length, 0);
  assert.equal(store.state.sessions.length, 0);
});

test('MQTT chamber 1 and 2 attach to their experiment sessions', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const { experiment, sessions } = await start(store);
  const t = new Date(experiment.startedAt.getTime() + 3600000);

  const r1 = await ingest(store, payload(1, t));
  const r2 = await ingest(store, payload(2, t));
  const s1 = sessions.find((s) => s.chamberId === 1);
  const s2 = sessions.find((s) => s.chamberId === 2);

  assert.equal(String(r1.reading.sesiId), String(s1._id));
  assert.equal(String(r2.reading.sesiId), String(s2._id));
  assert.equal(String(r1.session.experimentId), String(experiment._id));
  assert.equal(String(r2.session.experimentId), String(experiment._id));
  assert.equal(r1.session.masuk.toISOString(), t.toISOString());
  assert.equal(r2.session.masuk.toISOString(), t.toISOString());
  assert.equal(store.state.calls.predictInputs[0].features.hours, 1);
});

test('ingestion without an active experiment creates nothing', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  await assert.rejects(
    () => ingest(store, payload(1, new Date('2026-11-05T00:00:00Z'))),
    (err) => err.status === 409 && err.details?.code === 'NO_ACTIVE_EXPERIMENT'
  );
  assert.equal(store.state.readings.length, 0);
  assert.equal(store.state.sessions.length, 0);
});

test('an old legacy active session is never reused by new ingestion', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  store.state.sessions.push({
    _id: 'legacy-session-2',
    seq: 1,
    sesiCode: 'CH-010',
    chamberId: 2,
    status: 'aktif',
    masuk: new Date('2026-10-30T14:32:40.000Z'),
    experimentId: null,
  });

  await assert.rejects(
    () => ingest(store, payload(2, new Date('2026-11-05T00:00:00Z'))),
    (err) => err.status === 409 && err.details?.code === 'NO_ACTIVE_EXPERIMENT'
  );
  assert.equal(store.state.readings.length, 0);
  assert.equal(store.state.sessions.length, 1);
  assert.equal(store.state.sessions[0]._id, 'legacy-session-2');
});

test('a missing chamber session is an explicit integrity error', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const { experiment } = await start(store);
  store.state.sessions = store.state.sessions.filter((s) => s.chamberId !== 2);

  await assert.rejects(
    () => ingest(store, payload(2, new Date(experiment.startedAt.getTime() + 1000))),
    (err) => err.status === 409 && err.details?.code === 'MISSING_EXPERIMENT_SESSION'
  );
  assert.equal(store.state.readings.length, 0);
});

test('delayed MQTT event does not move the experiment start or session t0', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const { experiment } = await start(store);
  const newer = new Date(experiment.startedAt.getTime() + 2 * 3600000);
  const older = new Date(experiment.startedAt.getTime() + 1 * 3600000);

  await ingest(store, payload(1, newer));
  const started = experiment.startedAt.getTime();
  const session = store.state.sessions.find((s) => s.chamberId === 1);
  const prediksi = session.prediksiDibuat.getTime();

  await ingest(store, payload(1, older, { sample_id: 'delayed-cycle-1' }));

  assert.equal(experiment.startedAt.getTime(), started);
  assert.equal(session.prediksiDibuat.getTime(), prediksi);
  const delayedInput = store.state.calls.predictInputs.at(-1);
  assert.equal(delayedInput.features.hours, 1);
});

test('duplicate eventId creates no extra reading, prediction, or count', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const { experiment } = await start(store);
  const p = payload(1, new Date(experiment.startedAt.getTime() + 1000));

  const first = await ingest(store, p);
  const second = await ingest(store, p, 'sheet');

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(store.state.readings.length, 1);
  assert.equal(store.state.predictions.length, 1);
  assert.equal(store.state.calls.predict, 1);
  assert.equal(store.state.sessions.find((s) => s.chamberId === 1).readingCount, 1);
  assert.deepEqual(store.state.readings[0].sources.sort(), ['mqtt', 'sheet']);
});

test('stop closes both chamber sessions with one shared timestamp and is idempotent', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const { experiment } = await start(store);
  const t = new Date(experiment.startedAt.getTime() + 3600000);
  await ingest(store, payload(1, t));
  await ingest(store, payload(2, t));

  const first = await experimentService.stopExperiment(experiment._id, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: RSL_ESTIMATOR,
  });
  assert.equal(first.alreadyStopped, false);
  assert.equal(first.experiment.status, 'selesai');
  assert.ok(first.experiment.endedAt instanceof Date);
  assert.equal(first.sessions.length, 2);
  for (const s of first.sessions) {
    assert.equal(s.status, 'selesai');
    assert.equal(new Date(s.selesai).getTime(), first.experiment.endedAt.getTime());
    assert.ok(s.statusAkhir);
    assert.ok(s.sisaAkhirJam !== null);
  }

  const endedAt = first.experiment.endedAt.getTime();
  const second = await experimentService.stopExperiment(experiment._id, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: RSL_ESTIMATOR,
  });
  assert.equal(second.alreadyStopped, true);
  assert.equal(new Date(second.experiment.endedAt).getTime(), endedAt);
  assert.equal(store.state.experiments.length, 1);
});

test('historical sessions remain unchanged when an experiment stops', async () => {
  const store = createMemoryStore(); // seeded active experiment
  const historical = {
    _id: 'historical-session',
    seq: 99,
    sesiCode: 'CH-009',
    chamberId: 1,
    status: 'selesai',
    experimentId: null,
    masuk: new Date('2026-10-27T02:25:19.000Z'),
    selesai: new Date('2026-10-28T02:25:19.000Z'),
    statusAkhir: 'Layak Konsumsi',
    sisaAkhirJam: 12,
  };
  store.state.sessions.push(historical);
  const active = store.state.experiments.find((e) => e.status === 'aktif');

  await experimentService.stopExperiment(active._id, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: RSL_ESTIMATOR,
  });

  const after = store.state.sessions.find((s) => s._id === 'historical-session');
  assert.equal(after.status, 'selesai');
  assert.equal(after.selesai.toISOString(), historical.selesai.toISOString());
  assert.equal(after.statusAkhir, 'Layak Konsumsi');
  assert.equal(after.sisaAkhirJam, 12);
});

test('Sheet source without an active experiment creates nothing', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  await assert.rejects(
    () => ingest(store, payload(1, new Date('2026-11-05T00:00:00Z')), 'sheet'),
    (err) => err.status === 409 && err.details?.code === 'NO_ACTIVE_EXPERIMENT'
  );
  assert.equal(store.state.readings.length, 0);
  assert.equal(store.state.sessions.length, 0);
});

test('Sheet source with an active experiment uses the chamber session', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const { experiment, sessions } = await start(store);
  const t = new Date(experiment.startedAt.getTime() + 5000);
  const result = await ingest(store, payload(1, t), 'sheet');
  assert.equal(result.reading.source, 'sheet');
  assert.equal(String(result.reading.sesiId), String(sessions.find((s) => s.chamberId === 1)._id));
  assert.equal(store.state.readings.length, 1);
});

test('sessionView keeps historical null experiment fields backward-compatible', () => {
  const view = sessionView(
    {
      _id: 'historical',
      sesiCode: 'CH-009',
      chamberId: 1,
      status: 'selesai',
      masuk: new Date('2026-10-27T02:25:19Z'),
      selesai: new Date('2026-10-28T02:25:19Z'),
      experimentId: null,
    },
    ZONES,
    Date.now(),
    null
  );
  assert.equal(view.experimentId, null);
  assert.equal(view.experimentStartedAt, null);
  assert.equal(view.elapsedHours, null);
  assert.equal(view.masuk.toISOString(), '2026-10-27T02:25:19.000Z');
});

test('new experiment session view uses the shared start and has no fabricated baseline', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const { experiment, sessions } = await start(store);
  const view = sessionView(sessions.find((s) => s.chamberId === 1), ZONES, Date.now(), experiment.startedAt);
  assert.equal(view.masuk, null);
  assert.equal(view.tvocAwal, null);
  assert.equal(view.suhuAwal, null);
  assert.equal(view.rhAwal, null);
  assert.equal(view.experimentId, String(experiment._id));
  assert.equal(view.experimentStartedAt.getTime(), experiment.startedAt.getTime());
  assert.ok(view.durasiDetik >= 0);
  assert.ok(view.elapsedHours >= 0);
});

test('payload experiment_id cannot override the active experiment', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const { experiment } = await start(store);
  const t = new Date(experiment.startedAt.getTime() + 1000);
  const result = await ingest(store, payload(1, t, { experiment_id: 'bogus-experiment' }));
  assert.equal(String(result.session.experimentId), String(experiment._id));
});

test('a chamber outside the experiment is rejected explicitly', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const { experiment } = await start(store);
  experiment.chamberIds = [1];
  await assert.rejects(
    () => ingest(store, payload(2, new Date(experiment.startedAt.getTime() + 1000))),
    (err) => err.status === 409 && err.details?.code === 'CHAMBER_NOT_IN_EXPERIMENT'
  );
  assert.equal(store.state.readings.length, 0);
});

test('active/read endpoints return the experiment and both sessions', async () => {
  const store = createMemoryStore(undefined, { withExperiment: false });
  const { experiment } = await start(store, 'Read test');

  const active = await experimentService.getActiveExperiment({ models: store.models });
  assert.ok(active);
  assert.equal(String(active.experiment._id), String(experiment._id));
  assert.equal(active.sessions.length, 2);

  const detail = await experimentService.getExperiment(experiment._id, { models: store.models });
  assert.equal(detail.sessions.length, 2);

  const list = await experimentService.listExperiments({}, { models: store.models });
  assert.equal(list.length, 1);
});
