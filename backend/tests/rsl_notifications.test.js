const test = require('node:test');
const assert = require('node:assert/strict');

const notifier = require('../src/services/notifierService');
const { createMemoryStore } = require('./helpers/memoryStore');

const NOW = new Date('2026-11-05T20:00:00.000Z').getTime();
const SETTINGS = {
  zones: { segarHours: 24, rawanHours: 8 },
  updateIntervalMinutes: 5,
  notifications: {
    onSegeraJual: true,
    onTidakLayak: true,
    onOffline: true,
    onLowBattery: true,
    whatsapp: { recipients: ['6281234567890'] },
  },
};

function estimatorWith(lowerByChamber, unavailable = null) {
  return {
    async estimateForSession({ session }) {
      if (unavailable) {
        return {
          status: 'UNAVAILABLE',
          reason: unavailable,
          sampleStatus: session.sampleStatus || 'UNKNOWN',
          storageCondition: session.storageCondition || 'DRY',
          elapsedHours: 20,
          primary: null,
          supporting: null,
          metadata: {},
        };
      }
      const lower = lowerByChamber[session.chamberId];
      return {
        status: 'AVAILABLE',
        reason: null,
        sampleStatus: session.sampleStatus,
        storageCondition: session.storageCondition || 'DRY',
        elapsedHours: 20,
        primary: {
          method: 'M1',
          lowerHours: lower,
          upperHours: lower + 10,
          display: { lowerHours: Math.floor(lower), upperHours: Math.ceil(lower + 10) },
        },
        supporting: { M2: {}, M3: {} },
        metadata: { engineVersion: '1.0.0' },
      };
    },
  };
}

function readyStore() {
  const store = createMemoryStore(); // one active experiment + two sessions
  for (const session of store.state.sessions) {
    session.sampleStatus = 'NOT_SPOILED';
    session.storageCondition = 'DRY';
    session.masuk = new Date('2026-11-05T00:00:00Z');
    session.createdAt = new Date('2026-11-05T00:00:00Z');
    session.notified = { mulai: new Date(), offline: null };
  }
  return store;
}

function run(store, estimator, sender, extra = {}) {
  return notifier.checkOnce(NOW, {
    models: store.models,
    settings: SETTINGS,
    rslEstimator: estimator,
    sendWhatsApp: sender,
    isConfigured: () => true,
    skipBattery: true,
    ...extra,
  });
}

test('eligible M1 lower bound crossing creates one persisted notification and sends it', async () => {
  const store = readyStore();
  const sent = [];
  const result = await run(store, estimatorWith({ 1: 7, 2: 7 }), async (recipients, message) => {
    sent.push({ recipients, message });
  });

  assert.equal(result.eventsCreated, 2);
  assert.equal(sent.length, 2);
  assert.equal(store.state.notificationEvents.length, 2);
  for (const event of store.state.notificationEvents) {
    assert.equal(event.kind, 'rsl_low');
    assert.equal(event.thresholdHours, 8);
    assert.equal(event.lowerHours, 7);
    assert.equal(event.deliveryStatus, 'sent');
    assert.match(event.message, /batas bawah M1/i);
    assert.match(event.disclaimer, /bukan interval kepercayaan/i);
    assert.equal(event.experimentId, store.state.experiments[0]._id);
  }
});

test('M1 lower bound selects watch vs low vs no event deterministically', async () => {
  const store = readyStore();
  const sent = [];
  const result = await run(store, estimatorWith({ 1: 20, 2: 30 }), async () => sent.push(1));
  assert.equal(result.eventsCreated, 1);
  assert.equal(store.state.notificationEvents[0].kind, 'rsl_watch');
  assert.equal(store.state.notificationEvents[0].thresholdHours, 24);
  assert.equal(sent.length, 1);
});

test('repeated scheduler runs and restarts do not duplicate events or sends', async () => {
  const store = readyStore();
  const sent = [];
  const estimator = estimatorWith({ 1: 7, 2: 7 });
  await run(store, estimator, async () => sent.push(1));
  await run(store, estimator, async () => sent.push(1));
  // Simulated restart: same persistent state, fresh call.
  await run(store, estimator, async () => sent.push(1));
  assert.equal(store.state.notificationEvents.length, 2);
  assert.equal(sent.length, 2);
});

test('two chambers keep independent notification identities', async () => {
  const store = readyStore();
  await run(store, estimatorWith({ 1: 7, 2: 20 }), async () => {});
  const events = store.state.notificationEvents;
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => [e.chamberId, e.kind]).sort(), [
    [1, 'rsl_low'],
    [2, 'rsl_watch'],
  ]);
});

test('a new experiment gets a separate notification lifecycle', async () => {
  const first = readyStore();
  await run(first, estimatorWith({ 1: 7, 2: 7 }), async () => {});
  const firstExperimentId = first.state.experiments[0]._id;

  const second = readyStore();
  second.state.experiments[0]._id = 'new-experiment';
  for (const session of second.state.sessions) session.experimentId = 'new-experiment';
  await run(second, estimatorWith({ 1: 7, 2: 7 }), async () => {});

  assert.equal(first.state.notificationEvents.length, 2);
  assert.equal(second.state.notificationEvents.length, 2);
  assert.notEqual(firstExperimentId, second.state.notificationEvents[0].experimentId);
});

test('threshold changes use a new identity without replaying the old event', async () => {
  const store = readyStore();
  await run(store, estimatorWith({ 1: 20, 2: 30 }), async () => {});
  assert.equal(store.state.notificationEvents.length, 1);
  assert.equal(store.state.notificationEvents[0].thresholdHours, 24);

  const changed = {
    ...SETTINGS,
    zones: { segarHours: 12, rawanHours: 8 },
  };
  await notifier.checkOnce(NOW, {
    models: store.models,
    settings: changed,
    rslEstimator: estimatorWith({ 1: 10, 2: 30 }),
    sendWhatsApp: async () => {},
    isConfigured: () => true,
    skipBattery: true,
  });
  assert.equal(store.state.notificationEvents.length, 2);
  assert.equal(store.state.notificationEvents[1].thresholdHours, 12);
});

test('closed experiment produces no RSL notifications', async () => {
  const store = readyStore();
  store.state.experiments[0].status = 'selesai';
  const sent = [];
  const result = await run(store, estimatorWith({ 1: 7, 2: 7 }), async () => sent.push(1));
  assert.equal(result.eventsCreated, 0);
  assert.equal(store.state.notificationEvents.length, 0);
  assert.equal(sent.length, 0);
});

test('UNKNOWN, SPOILED, WATER, outside support, and engine timeout never fall back to mock notifications', async () => {
  for (const reason of [
    'SAMPLE_STATUS_UNKNOWN',
    'SAMPLE_REPORTED_SPOILED',
    'UNSUPPORTED_STORAGE_CONDITION',
    'OUTSIDE_REFERENCE_SUPPORT',
    'RSL_TIMEOUT',
  ]) {
    const store = readyStore();
    const sent = [];
    const result = await run(store, estimatorWith({ 1: 7, 2: 7 }, reason), async () => sent.push(1));
    assert.equal(result.eventsCreated, 0, reason);
    assert.equal(store.state.notificationEvents.length, 0, reason);
    assert.equal(sent.length, 0, reason);
  }

  const throwingStore = readyStore();
  const sent = [];
  const result = await run(
    throwingStore,
    {
      async estimateForSession() {
        throw new Error('RSL service down');
      },
    },
    async () => sent.push(1)
  );
  assert.equal(result.eventsCreated, 0);
  assert.equal(throwingStore.state.notificationEvents.length, 0);
  assert.equal(sent.length, 0);
});

test('notification send failure is recorded and does not throw or interrupt the worker', async () => {
  const store = readyStore();
  const result = await run(store, estimatorWith({ 1: 7, 2: 7 }), async () => {
    throw new Error('WhatsApp gateway down');
  });
  assert.equal(result.eventsCreated, 2);
  assert.equal(result.sent, 0);
  assert.equal(store.state.notificationEvents.length, 2);
  for (const event of store.state.notificationEvents) {
    assert.equal(event.deliveryStatus, 'failed');
    assert.match(event.error, /gateway down/);
  }
});

test('legacy message builders remain compatible but scheduler no longer uses mock countdown', async () => {
  const legacy = notifier.buildMessage({
    kind: 'segeraJual',
    chamberName: 'Chamber 1',
    sesiCode: 'CH-061',
    sisaDetik: 7 * 3600,
    reading: { suhu: 20.14, rh: 72, tvoc: 309.4 },
    zones: SETTINGS.zones,
  });
  assert.match(legacy, /Segera Konsumsi/);
  assert.match(legacy, /±7 jam/);

  const store = readyStore();
  await run(store, estimatorWith({ 1: 7, 2: 7 }), async () => {});
  assert.doesNotMatch(store.state.notificationEvents[0].message, /countdown|mock/i);
  assert.match(store.state.notificationEvents[0].message, /M1/);
});
