const test = require('node:test');
const assert = require('node:assert/strict');

const { ingestReading } = require('../src/services/ingestService');
const { createMemoryStore } = require('./helpers/memoryStore');
const env = require('../src/config/env');
const predictionService = require('../src/services/predictionService');

const RECEIVED = new Date('2026-11-05T00:05:00.000Z');

function mqttPayload(overrides = {}) {
  return {
    sample_id: 'tofusense-FCF5C46F0E2C-1793817129-1',
    device_id: 'tofusense-FCF5C46F0E2C',
    chamber_id: 1,
    tvoc: 98,
    suhu: 27.54,
    rh: 79.59,
    sampled_at: '2026-11-05T00:00:00Z',
    ...overrides,
  };
}

function sheetPayload(overrides = {}) {
  // The fallback importer normalises a sheet row into the same payload shape.
  return mqttPayload(overrides);
}

async function ingest(store, payload, source = 'mqtt', receivedAt = RECEIVED) {
  return ingestReading(payload, { source, receivedAt }, store);
}

test('a valid MQTT message is stored once with its identity', async () => {
  const store = createMemoryStore();
  const result = await ingest(store, mqttPayload());
  assert.equal(store.state.readings.length, 1);
  assert.equal(store.state.predictions.length, 1);
  assert.equal(result.duplicate, false);
  const reading = store.state.readings[0];
  assert.equal(reading.eventId, 'tofusense-FCF5C46F0E2C-1793817129-1-ch1');
  assert.equal(reading.sampleId, 'tofusense-FCF5C46F0E2C-1793817129-1');
  assert.equal(reading.deviceId, 'tofusense-FCF5C46F0E2C');
  assert.equal(reading.source, 'mqtt');
  assert.deepEqual(reading.sources, ['mqtt']);
  assert.equal(reading.timestampSource, 'sampled');
  assert.equal(reading.timestamp.toISOString(), '2026-11-05T00:00:00.000Z');
});

test('an ESP32 temp/humid payload is persisted with the same identity and deduplicates', async () => {
  const store = createMemoryStore();
  const aliasPayload = {
    sample_id: 'tofusense-FCF5C46F0E2C-1793817129-1',
    device_id: 'tofusense-FCF5C46F0E2C',
    chamber_id: 1,
    tvoc: 98,
    temp: 27.54,
    humid: 79.59,
    sampled_at: '2026-11-05T00:00:00Z',
  };
  const first = await ingest(store, aliasPayload);
  assert.equal(first.duplicate, false);
  const reading = store.state.readings[0];
  assert.equal(reading.suhu, 27.54);
  assert.equal(reading.rh, 79.59);
  assert.equal(reading.eventId, 'tofusense-FCF5C46F0E2C-1793817129-1-ch1');
  assert.equal(reading.timestamp.toISOString(), '2026-11-05T00:00:00.000Z');

  // The canonical firmware format for the same event must deduplicate.
  const second = await ingest(store, mqttPayload());
  assert.equal(second.duplicate, true);
  assert.equal(store.state.readings.length, 1);
  assert.equal(store.state.predictions.length, 1);
});

test('an ESP32 temperature/humidity payload is persisted', async () => {
  const store = createMemoryStore();
  const aliasPayload = {
    sample_id: 'tofusense-FCF5C46F0E2C-1793817129-2',
    device_id: 'tofusense-FCF5C46F0E2C',
    chamber_id: 2,
    tvoc: 111,
    temperature: 27.53,
    humidity: 78.92,
    sampled_at: '2026-11-05T00:00:00Z',
  };
  const result = await ingest(store, aliasPayload);
  assert.equal(result.duplicate, false);
  const reading = store.state.readings[0];
  assert.equal(reading.chamberId, 2);
  assert.equal(reading.suhu, 27.53);
  assert.equal(reading.rh, 78.92);
  assert.equal(reading.eventId, 'tofusense-FCF5C46F0E2C-1793817129-2-ch2');
});

test('ML_MODE=off stores readings but skips predictions and session ML fields', async () => {
  const oldMode = env.ml.mode;
  env.ml.mode = 'off';
  try {
    const store = createMemoryStore();
    // Exercise the real prediction service so ML_MODE=off is covered end to end.
    store.predictionService = predictionService;
    const result = await ingest(store, mqttPayload());
    assert.equal(result.prediction, null);
    assert.equal(result.predictionDisabled, true);
    assert.equal(store.state.readings.length, 1);
    assert.equal(store.state.predictions.length, 0);
    assert.equal(store.state.sessions[0].readingCount, 1);
    assert.equal(store.state.sessions[0].shelfLifeAwal, null);
    assert.equal(store.state.sessions[0].shelfLifeMulai, null);
    assert.equal(store.state.sessions[0].modelUsed, null);
  } finally {
    env.ml.mode = oldMode;
  }
});

test('the same MQTT event arriving twice is stored once', async () => {
  const store = createMemoryStore();
  await ingest(store, mqttPayload());
  const second = await ingest(store, mqttPayload());
  assert.equal(second.duplicate, true);
  assert.equal(store.state.readings.length, 1);
  assert.equal(store.state.predictions.length, 1);
  assert.equal(store.state.calls.predict, 1);
});

test('MQTT then a Sheets duplicate stores one reading and records both sources', async () => {
  const store = createMemoryStore();
  await ingest(store, mqttPayload(), 'mqtt');
  const second = await ingest(store, sheetPayload(), 'sheet');
  assert.equal(second.duplicate, true);
  assert.equal(store.state.readings.length, 1);
  assert.deepEqual(store.state.readings[0].sources.sort(), ['mqtt', 'sheet']);
});

test('Sheets fallback first then a delayed MQTT duplicate stores one reading', async () => {
  const store = createMemoryStore();
  await ingest(store, sheetPayload(), 'sheet');
  const second = await ingest(store, mqttPayload(), 'mqtt');
  assert.equal(second.duplicate, true);
  assert.equal(store.state.readings.length, 1);
  assert.equal(store.state.readings[0].source, 'sheet');
});

test('two chambers of one cycle both survive with distinct event ids', async () => {
  const store = createMemoryStore();
  await ingest(store, mqttPayload({ chamber_id: 1 }), 'mqtt');
  await ingest(store, mqttPayload({ chamber_id: 2, tvoc: 111, suhu: 27.53 }), 'mqtt');
  assert.equal(store.state.readings.length, 2);
  assert.deepEqual(store.state.readings.map((r) => r.eventId).sort(),
    ['tofusense-FCF5C46F0E2C-1793817129-1-ch1', 'tofusense-FCF5C46F0E2C-1793817129-1-ch2']);
});

test('a duplicate does not touch the session counter or the prediction again', async () => {
  const store = createMemoryStore();
  await ingest(store, mqttPayload());
  const sessionUpdates = store.state.calls.sessionUpdates;
  const predictions = store.state.calls.createPrediction;
  await ingest(store, mqttPayload(), 'sheet');
  assert.equal(store.state.calls.sessionUpdates, sessionUpdates);
  assert.equal(store.state.calls.createPrediction, predictions);
});

test('idempotency survives a backend restart (same database, new process)', async () => {
  const shared = createMemoryStore().state;
  const first = createMemoryStore(shared);
  await ingest(first, mqttPayload());
  const restarted = createMemoryStore(shared);
  const second = await ingest(restarted, mqttPayload(), 'sheet');
  assert.equal(second.duplicate, true);
  assert.equal(shared.readings.length, 1);
});

test('invalid chamber ids are rejected', async () => {
  const store = createMemoryStore();
  await assert.rejects(() => ingest(store, mqttPayload({ chamber_id: 3 })), /chamber_id/);
  await assert.rejects(() => ingest(store, mqttPayload({ chamber_id: 0 })), /chamber_id/);
  assert.equal(store.state.readings.length, 0);
});

test('out-of-range sensor values are rejected', async () => {
  const store = createMemoryStore();
  await assert.rejects(() => ingest(store, mqttPayload({ tvoc: -1 })), /tvoc/);
  await assert.rejects(() => ingest(store, mqttPayload({ suhu: 120 })), /suhu/);
  await assert.rejects(() => ingest(store, mqttPayload({ rh: -5 })), /rh/);
  assert.equal(store.state.readings.length, 0);
});

test('a missing sample time is stored with a quality flag and reception time', async () => {
  const store = createMemoryStore();
  const payload = mqttPayload();
  delete payload.sampled_at;
  const result = await ingest(store, payload);
  const reading = result.reading;
  assert.equal(reading.sampledAt, null);
  assert.equal(reading.timestampSource, 'received_at');
  assert.equal(reading.timestampQuality, 'MISSING');
  assert.equal(reading.receivedAt.toISOString(), RECEIVED.toISOString());
});

test('a late event keeps its own sample time and does not rewind the session', async () => {
  const store = createMemoryStore();
  await ingest(store, mqttPayload({ sampled_at: '2026-11-05T00:00:00Z' }));
  const session = store.state.sessions[0];
  const newest = new Date('2026-11-05T00:00:00Z').getTime();
  assert.equal(new Date(session.prediksiDibuat).getTime(), newest);

  // A delayed older sample arrives later.
  await ingest(store, mqttPayload({
    sample_id: 'tofusense-OLD-111-1',
    sampled_at: '2026-11-04T22:00:00Z',
  }));
  assert.equal(new Date(session.prediksiDibuat).getTime(), newest, 'session t0 must not move backwards');
  assert.equal(store.state.readings.length, 2, 'the late reading is still stored');
  const late = store.state.readings.find((r) => r.sampleId === 'tofusense-OLD-111-1');
  assert.equal(late.timestamp.toISOString(), '2026-11-04T22:00:00.000Z');
});
