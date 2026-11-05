const test = require('node:test');
const assert = require('node:assert/strict');

const {
  deriveEventId,
  sanitiseSampleId,
  resolveEventIdentity,
  resolveSampleTime,
} = require('../src/utils/identity');

const RECEIVED = new Date('2026-11-05T00:05:00.000Z');

test('deriveEventId is deterministic and chamber-specific', () => {
  const sample = 'tofusense-FCF5C46F0E2C-1793817129-1';
  assert.equal(deriveEventId(sample, 1), `${sample}-ch1`);
  assert.equal(deriveEventId(sample, 2), `${sample}-ch2`);
  assert.notEqual(deriveEventId(sample, 1), deriveEventId(sample, 2));
});

test('the same cycle produces the same event ids from MQTT payload and sheet row', () => {
  const sample = 'tofusense-ABC-1793817129-3';
  const mqtt = resolveEventIdentity({ sample_id: sample, chamber_id: 2 }, 2);
  const sheet = resolveEventIdentity({ sample_id: sample, chamber_id: 2 }, 2);
  assert.equal(mqtt.eventId, sheet.eventId);
  assert.equal(mqtt.eventId, `${sample}-ch2`);
  assert.equal(mqtt.identitySource, 'sample_id');
});

test('sample ids are trimmed and validated', () => {
  assert.equal(sanitiseSampleId('  abc-123  '), 'abc-123');
  assert.equal(sanitiseSampleId(''), null);
  assert.equal(sanitiseSampleId(null), null);
  assert.throws(() => sanitiseSampleId('bad id with spaces'), /sample_id/);
  assert.throws(() => sanitiseSampleId('x'.repeat(200)), /sample_id/);
});

test('legacy payloads without identity stay valid but unidentified', () => {
  const identity = resolveEventIdentity({ chamber_id: 1, tvoc: 10 }, 1);
  assert.equal(identity.eventId, null);
  assert.equal(identity.identitySource, 'absent');
});

test('an explicit event_id is accepted when no sample_id is present', () => {
  const identity = resolveEventIdentity({ event_id: 'manual-event-1', chamber_id: 1 }, 1);
  assert.equal(identity.eventId, 'manual-event-1');
  assert.equal(identity.identitySource, 'event_id');
});

test('a mismatched event_id and sample_id are rejected', () => {
  assert.throws(
    () => resolveEventIdentity({ sample_id: 'cycle-1', event_id: 'cycle-1-ch2', chamber_id: 1 }, 1),
    /event_id/
  );
});

test('sampled_at is the canonical sample time when valid', () => {
  const time = resolveSampleTime({ sampled_at: '2026-11-05T00:00:00Z' }, RECEIVED);
  assert.equal(time.timestampSource, 'sampled');
  assert.equal(time.timestampQuality, 'OK');
  assert.equal(time.timestamp.toISOString(), '2026-11-05T00:00:00.000Z');
  assert.equal(time.receivedAt.toISOString(), RECEIVED.toISOString());
});

test('the legacy timestamp field is accepted as a sample time', () => {
  const time = resolveSampleTime({ timestamp: '2026-11-05T00:01:00Z' }, RECEIVED);
  assert.equal(time.timestampSource, 'sampled');
  assert.equal(time.timestamp.toISOString(), '2026-11-05T00:01:00.000Z');
});

test('a missing sample time is flagged and never passed off as sampled', () => {
  const time = resolveSampleTime({}, RECEIVED);
  assert.equal(time.sampledAt, null);
  assert.equal(time.timestampSource, 'received_at');
  assert.equal(time.timestampQuality, 'MISSING');
  assert.equal(time.timestamp.toISOString(), RECEIVED.toISOString());
});

test('an invalid sample time is flagged, not silently replaced with received time as sampled', () => {
  const time = resolveSampleTime({ sampled_at: 'not-a-date' }, RECEIVED);
  assert.equal(time.sampledAt, null);
  assert.equal(time.timestampSource, 'received_at');
  assert.equal(time.timestampQuality, 'INVALID');
});

test('future sample times beyond the tolerance are rejected', () => {
  const time = resolveSampleTime({ sampled_at: '2026-11-07T00:00:00Z' }, RECEIVED);
  assert.equal(time.sampledAt, null);
  assert.equal(time.timestampQuality, 'INVALID');
});
