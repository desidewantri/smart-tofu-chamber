/**
 * Real MQTT integration test: a real broker (Aedes) + the real `mqtt` client +
 * the real subscriber wiring + the canonical ingestion layer.
 *
 * Only MongoDB is faked; the protocol, topic parsing, reconnect setup and
 * dedup path are the production ones.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { once } = require('node:events');
const mqtt = require('mqtt');
const createAedes = require('aedes');

const service = require('../src/services/mqttService');
const { ingestReading } = require('../src/services/ingestService');
const { createMemoryStore } = require('./helpers/memoryStore');

const SAMPLE = 'tofusense-FCF5C46F0E2C-1793817129-1';
const RECEIVED = new Date('2026-11-05T00:05:00Z');

function payload(chamber, overrides = {}) {
  return {
    event_id: `${SAMPLE}-ch${chamber}`,
    sample_id: SAMPLE,
    device_id: 'tofusense-FCF5C46F0E2C',
    chamber_id: chamber,
    tvoc: chamber === 1 ? 88 : 111,
    suhu: chamber === 1 ? 27.54 : 27.53,
    rh: chamber === 1 ? 78.92 : 77.56,
    sampled_at: '2026-11-05T00:00:00Z',
    timestamp: '2026-11-05T00:00:00Z',
    ...overrides,
  };
}

async function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

test('real MQTT broker end-to-end: publish, subscribe, dedup, store', async (t) => {
  const broker = createAedes();
  const server = net.createServer(broker.handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `mqtt://127.0.0.1:${server.address().port}`;
  const store = createMemoryStore();

  const subscribed = once(broker, 'subscribe');
  const backend = service.start({
    config: { enabled: true, url, topic: 'smartchamber/sensor/+',
              clientId: `test-backend-${Date.now()}` },
    deps: store,
  });
  const publisher = mqtt.connect(url, { clientId: `test-pub-${Date.now()}` });

  try {
    await Promise.all([once(backend, 'connect'), once(publisher, 'connect')]);
    await subscribed;

    await t.test('one cycle produces two chamber readings', async () => {
      publisher.publish('smartchamber/sensor/1', JSON.stringify(payload(1)));
      publisher.publish('smartchamber/sensor/2', JSON.stringify(payload(2)));
      assert.ok(await waitFor(() => store.state.readings.length === 2));
      const byChamber = Object.fromEntries(store.state.readings.map((r) => [r.chamberId, r]));
      assert.equal(byChamber[1].tvoc, 88);
      assert.equal(byChamber[2].tvoc, 111);
      assert.equal(byChamber[1].eventId, `${SAMPLE}-ch1`);
      assert.equal(byChamber[2].eventId, `${SAMPLE}-ch2`);
      assert.deepEqual(byChamber[1].sources, ['mqtt']);
      assert.equal(store.state.predictions.length, 2);
      assert.equal(store.state.sessions.length, 2);
    });

    await t.test('a redelivered MQTT message is stored once', async () => {
      publisher.publish('smartchamber/sensor/1', JSON.stringify(payload(1)));
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.equal(store.state.readings.length, 2);
      assert.equal(store.state.predictions.length, 2);
    });

    await t.test('concurrent duplicate delivery is stored once', async () => {
      const sample = 'tofusense-CONCURRENT-1-1';
      for (let i = 0; i < 4; i += 1) {
        publisher.publish('smartchamber/sensor/1', JSON.stringify(payload(1, {
          sample_id: sample, event_id: `${sample}-ch1`,
        })));
      }
      assert.ok(await waitFor(() =>
        store.state.readings.filter((r) => r.sampleId === sample).length === 1));
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(store.state.readings.filter((r) => r.sampleId === sample).length, 1);
    });

    await t.test('malformed JSON is rejected without killing the subscriber', async () => {
      const before = store.state.readings.length;
      publisher.publish('smartchamber/sensor/1', '{not valid json');
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(store.state.readings.length, before);
      // still alive:
      const sample = 'tofusense-AFTERBAD-1-1';
      publisher.publish('smartchamber/sensor/1', JSON.stringify(payload(1, {
        sample_id: sample, event_id: `${sample}-ch1`,
      })));
      assert.ok(await waitFor(() =>
        store.state.readings.some((r) => r.sampleId === sample)));
    });

    await t.test('out-of-range sensor values are rejected', async () => {
      const before = store.state.readings.length;
      const sample = 'tofusense-BAD-1-1';
      publisher.publish('smartchamber/sensor/1', JSON.stringify(payload(1, {
        sample_id: sample, event_id: `${sample}-ch1`, tvoc: -5,
      })));
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(store.state.readings.length, before);
    });

    await t.test('a Sheets duplicate after MQTT adds provenance only', async () => {
      const result = await ingestReading(payload(1), { source: 'sheet', receivedAt: RECEIVED }, store);
      assert.equal(result.duplicate, true);
      const reading = store.state.readings.find((r) => r.eventId === `${SAMPLE}-ch1`);
      assert.deepEqual(reading.sources.sort(), ['mqtt', 'sheet']);
      assert.equal(reading.tvoc, 88, 'original measurement must not be overwritten');
    });

    await t.test('a delayed MQTT event does not rewind the session', async () => {
      const session = store.state.sessions.find((s) => s.chamberId === 1);
      const t0 = new Date(session.prediksiDibuat).getTime();
      const sample = 'tofusense-DELAYED-1-1';
      publisher.publish('smartchamber/sensor/1', JSON.stringify(payload(1, {
        sample_id: sample, event_id: `${sample}-ch1`, sampled_at: '2026-11-04T22:00:00Z',
      })));
      assert.ok(await waitFor(() =>
        store.state.readings.some((r) => r.sampleId === sample)));
      assert.equal(new Date(session.prediksiDibuat).getTime(), t0);
      const late = store.state.readings.find((r) => r.sampleId === sample);
      assert.equal(late.timestamp.toISOString(), '2026-11-04T22:00:00.000Z');
    });
  } finally {
    publisher.end(true);
    await service.stop();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => broker.close(resolve));
  }
});

test('the subscriber redacts credentials from its status', () => {
  const redacted = service.redactUrl('mqtt://user:secret@broker.example:1883');
  assert.equal(redacted.includes('secret'), false);
  assert.equal(redacted.includes('user'), false);
  assert.equal(redacted.includes('broker.example'), true);
});
