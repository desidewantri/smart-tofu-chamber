const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validatePayload } = require('../src/services/ingestService');
const { deriveEventId } = require('../src/utils/identity');

const SKETCH = path.join(__dirname, '..', '..', 'firmware', 'toscha_esp32_bench',
  'toscha_esp32_bench.ino');
const source = fs.readFileSync(SKETCH, 'utf8');

test('the sketch publishes to the topic the backend subscribes to', () => {
  assert.match(source, /smartchamber\/sensor\//);
  assert.match(source, /TOPIC_PREFIX/);
});

test('the MQTT payload carries the event identity and both timestamp fields', () => {
  for (const field of ['event_id', 'sample_id', 'device_id', 'chamber_id', 'tvoc', 'suhu', 'rh', 'sampled_at', 'timestamp']) {
    assert.ok(source.includes(`"${field}"`), `missing MQTT field ${field}`);
  }
  assert.match(source, /eventIdFor\(sampleId, chamber\)/);
  assert.match(source, /sampleId \+ "-ch" \+ String\(chamber\)/);
});

test('one cycle builds two chamber messages from one sample id', () => {
  assert.match(source, /publishChamberMqtt\(1, result\.sampleId/);
  assert.match(source, /publishChamberMqtt\(2, result\.sampleId/);
  assert.equal((source.match(/makeSampleId\(sampleEpoch\)/g) || []).length, 1);
});

test('GB is omitted rather than fabricated', () => {
  assert.ok(!/addJson\w+\(payload, "vbat"/.test(source), 'firmware must not invent vbat');
  assert.match(source, /vbat intentionally omitted/i);
});

test('MQTT failure cannot block the Sheets upload', () => {
  const mqttIndex = source.indexOf('publishChamberMqtt(2');
  const sheetIndex = source.indexOf('uploadToGoogleSheets(payload)');
  assert.ok(mqttIndex > 0 && sheetIndex > mqttIndex, 'Sheets must run after both MQTT attempts');
  assert.ok(!/return result;[\s\S]{0,80}if \(!result\.mqtt/.test(source));
});

test('the sketch keeps the bench profile: no deep sleep, persistent WiFi', () => {
  assert.ok(!source.includes('esp_deep_sleep_start'), 'deep sleep is out of scope for the bench profile');
  assert.match(source, /WiFi\.setAutoReconnect\(true\)/);
  assert.match(source, /CYCLE_MS = 300000/);
});

test('the backend accepts the exact payload the firmware builds', () => {
  const received = new Date('2026-11-05T00:05:00Z');
  const sample = 'tofusense-FCF5C46F0E2C-1793817129-1';
  const firmware = JSON.parse(
    '{"event_id":"' + sample + '-ch1","sample_id":"' + sample + '",' +
    '"device_id":"tofusense-FCF5C46F0E2C","chamber_id":1,"tvoc":88,' +
    '"suhu":27.54,"rh":78.92,"sampled_at":"2026-11-04T18:15:29Z",' +
    '"timestamp":"2026-11-04T18:15:29Z"}'
  );
  const parsed = validatePayload(firmware, undefined, received);
  assert.equal(parsed.chamberId, 1);
  assert.equal(parsed.tvoc, 88);
  assert.equal(parsed.suhu, 27.54);
  assert.equal(parsed.rh, 78.92);
  assert.equal(parsed.battery, null);
  assert.equal(parsed.eventId, deriveEventId(sample, 1));
  assert.equal(parsed.sampledAt.toISOString(), '2026-11-04T18:15:29.000Z');
  assert.equal(parsed.receivedAt.toISOString(), '2026-11-05T00:05:00.000Z');
  assert.equal(parsed.timestamp.toISOString(), '2026-11-04T18:15:29.000Z');
});

test('chamber 2 of the same cycle is a different event', () => {
  const sample = 'tofusense-FCF5C46F0E2C-1793817129-1';
  assert.notEqual(deriveEventId(sample, 1), deriveEventId(sample, 2));
});

test('the Google Sheets payload keeps the testing-tab fields', () => {
  for (const field of ['api_key', 'sample_id', 'sampled_at', 'temp1', 'humid1', 'tvoc1',
    'temp2', 'humid2', 'tvoc2']) {
    assert.ok(source.includes(`"${field}"`), `missing Sheets field ${field}`);
  }
});

test('a real MQTT host is not mistaken for a placeholder', () => {
  // The placeholder is the literal prefix "ISI_". Gating on the first character
  // would silently disable MQTT for any real host starting with "I".
  assert.match(source, /strncmp\(MQTT_HOST,\s*"ISI_",\s*4\)/);
  assert.ok(!/MQTT_HOST\[0\]\s*!=\s*'I'/.test(source));
});
