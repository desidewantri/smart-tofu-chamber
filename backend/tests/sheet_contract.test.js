const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../src/services/sheetImportService');
const { deriveEventId } = require('../src/utils/identity');

// Exact header of the live "testing" tab.
const HEADER = 'received_at,sample_id,sampled_at,temp1,humid1,tvoc1,temp2,humid2,tvoc2,vbat';
const ROWS = [
  '11/5/2026,tofusense-FCF5C46F0E2C-1793816129-1,2026-11-04T18:15:29Z,27.54,78.92,88,27.54,77.56,111,',
  '11/5/2026,tofusense-FCF5C46F0E2C-1793816836-1,2026-11-04T18:27:16Z,27.57,79.03,89,27.53,77.81,111,',
];
const CSV = [HEADER, ...ROWS].join('\n');

test('the live testing-tab schema is parsed into two chamber readings per cycle', () => {
  const readings = s.rowsToReadings(s.parseCsv(CSV));
  assert.equal(readings.length, 4);
  const first = readings.filter((r) => r.rowIndex === 0);
  assert.equal(first.length, 2);
  const c1 = first.find((r) => r.chamberId === 1);
  const c2 = first.find((r) => r.chamberId === 2);
  assert.equal(c1.tvoc, 88);
  assert.equal(c1.suhu, 27.54);
  assert.equal(c1.rh, 78.92);
  assert.equal(c2.tvoc, 111);
  assert.equal(c2.suhu, 27.54);
  assert.equal(c2.rh, 77.56);
  assert.equal(c1.sampleId, 'tofusense-FCF5C46F0E2C-1793816129-1');
  assert.equal(c1.sampledAt.toISOString(), '2026-11-04T18:15:29.000Z');
  assert.equal(c2.sampledAt.toISOString(), '2026-11-04T18:15:29.000Z');
  assert.equal(c1.battery, null);
});

test('sheet rows derive exactly the same event ids as MQTT', () => {
  const readings = s.rowsToReadings(s.parseCsv(CSV));
  for (const reading of readings) {
    assert.equal(reading.eventId, deriveEventId(reading.sampleId, reading.chamberId));
  }
});

test('received_at is kept separate from sampled_at', () => {
  const [reading] = s.rowsToReadings(s.parseCsv(CSV));
  assert.ok(reading.receivedAt instanceof Date);
  assert.notEqual(reading.receivedAt.getTime(), reading.sampledAt.getTime());
});

test('legacy timestamp column still works without sample_id', () => {
  const legacy = [
    'timestamp,temp1,humid1,tvoc1,temp2,humid2,tvoc2',
    '10/22/2026 21:34:43,32.27,91.85,3451,32.22,91.45,1243',
  ].join('\n');
  const readings = s.rowsToReadings(s.parseCsv(legacy));
  assert.equal(readings.length, 2);
  assert.equal(readings[0].sampleId, null);
  assert.equal(readings[0].eventId, null);
  assert.equal(readings[0].timestamp.toISOString(), '2026-10-22T14:34:43.000Z');
});

test('rows without sampled_at fall back to received_at and are marked as such', () => {
  const noSample = [
    'received_at,sample_id,temp1,humid1,tvoc1,temp2,humid2,tvoc2',
    '11/5/2026,tofusense-ABC-1-1,27.5,79,88,27.5,77,111',
  ].join('\n');
  const [reading] = s.rowsToReadings(s.parseCsv(noSample));
  assert.equal(reading.sampledAt, null);
  assert.ok(reading.receivedAt instanceof Date);
  assert.equal(reading.timestampQuality, 'MISSING');
});

test('selectFresh can use the monotonic row index instead of sample time', () => {
  const t = (m) => new Date(Date.UTC(2026, 10, 4, 6, m));
  const rows = [
    { chamberId: 1, timestamp: t(5), rowIndex: 0 },
    { chamberId: 1, timestamp: t(0), rowIndex: 1 }, // late-arriving, older sample
    { chamberId: 1, timestamp: t(10), rowIndex: 2 },
  ];
  const fresh = s.selectFresh(rows, 1, { lastRowIndex: 0 });
  assert.deepEqual(fresh.map((r) => r.rowIndex), [1, 2]);
});
