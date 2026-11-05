const test = require('node:test');
const assert = require('node:assert/strict');

const s = require('../src/services/sheetImportService');
const { ingestReading } = require('../src/services/ingestService');
const { createMemoryStore } = require('./helpers/memoryStore');

const RECEIVED = new Date('2026-11-05T00:05:00.000Z');

// Legacy Apps Script `Data` tab: 8 columns, timestamp generated at receipt.
const LEGACY = [
  'timestamp,temp1,humid1,tvoc1,temp2,humid2,tvoc2,vbat',
  '10/22/2026 21:34:43,32.27,91.85,3451,32.22,91.45,1243,72',
].join('\n');

// Phase 7 `testing` tab: identity + explicit acquisition/receipt times.
const PHASE7 = [
  'received_at,sample_id,sampled_at,temp1,humid1,tvoc1,temp2,humid2,tvoc2,vbat',
  '11/5/2026,tofusense-ABC-1793816129-1,2026-11-04T18:15:29Z,27.54,78.92,88,27.54,77.56,111,',
].join('\n');

test('legacy Data header parses both chambers and vbat', () => {
  const readings = s.rowsToReadings(s.parseCsv(LEGACY));
  assert.equal(readings.length, 2);
  const c1 = readings.find((r) => r.chamberId === 1);
  const c2 = readings.find((r) => r.chamberId === 2);
  assert.equal(c1.tvoc, 3451);
  assert.equal(c1.suhu, 32.27);
  assert.equal(c1.rh, 91.85);
  assert.equal(c1.battery, 72);
  assert.equal(c2.tvoc, 1243);
  assert.equal(c2.suhu, 32.22);
  assert.equal(c2.rh, 91.45);
});

test('legacy timestamp is receipt time, never acquisition time', () => {
  const [reading] = s.rowsToReadings(s.parseCsv(LEGACY));
  assert.equal(reading.sampledAt, null, 'legacy timestamp must not be reported as sampled_at');
  assert.ok(reading.receivedAt instanceof Date);
  assert.equal(reading.receivedAt.toISOString(), '2026-10-22T14:34:43.000Z');
  assert.equal(reading.timestamp.toISOString(), '2026-10-22T14:34:43.000Z');
  assert.equal(reading.timestampQuality, 'MISSING');
  assert.equal(reading.sampleId, null);
  assert.equal(reading.eventId, null);
});

test('Phase 7 sampled_at is acquisition time and received_at stays separate', () => {
  const readings = s.rowsToReadings(s.parseCsv(PHASE7));
  assert.equal(readings.length, 2);
  const c1 = readings.find((r) => r.chamberId === 1);
  assert.equal(c1.sampledAt.toISOString(), '2026-11-04T18:15:29.000Z');
  assert.ok(c1.receivedAt instanceof Date);
  assert.notEqual(c1.receivedAt.getTime(), c1.sampledAt.getTime());
  assert.equal(c1.timestamp.toISOString(), '2026-11-04T18:15:29.000Z');
  assert.equal(c1.timestampQuality, 'OK');
  assert.equal(c1.eventId, 'tofusense-ABC-1793816129-1-ch1');
  assert.equal(readings.find((r) => r.chamberId === 2).eventId, 'tofusense-ABC-1793816129-1-ch2');
});

test('explicit received_at wins over legacy timestamp; sampled_at wins for ordering', () => {
  const csv = [
    'timestamp,received_at,sample_id,sampled_at,temp1,humid1,tvoc1,temp2,humid2,tvoc2',
    '10/22/2026 21:34:43,10/22/2026 21:35:00,cycle-1,2026-10-22T14:34:00Z,27.5,79,88,27.5,77,111',
  ].join('\n');
  const [reading] = s.rowsToReadings(s.parseCsv(csv));
  assert.equal(reading.sampledAt.toISOString(), '2026-10-22T14:34:00.000Z');
  assert.equal(reading.receivedAt.toISOString(), '2026-10-22T14:35:00.000Z');
  assert.equal(reading.timestamp.toISOString(), '2026-10-22T14:34:00.000Z');
  assert.equal(reading.timestampQuality, 'OK');
});

test('missing time columns produce an explicit diagnostic', () => {
  assert.throws(
    () => s.rowsToReadings(s.parseCsv('foo,bar\n1,2')),
    (err) => /sampled_at/.test(err.message) && /received_at/.test(err.message) && /timestamp/.test(err.message)
  );
});

test('historical session tabs are rejected explicitly, not silently imported', () => {
  const historical = [
    'timestamp,tvoc1,tvoc2,grad tvoc1,grad tvoc2,catatan,Lama Pengujian',
    '10/31/2026 18:20:00,120,130,1,2,ok,60',
  ].join('\n');
  assert.throws(
    () => s.rowsToReadings(s.parseCsv(historical)),
    /temp1\/humid1\/tvoc1/
  );
});

test('an incomplete chamber is skipped without discarding the other chamber', () => {
  const csv = [
    'timestamp,temp1,humid1,tvoc1,temp2,humid2,tvoc2',
    '10/22/2026 21:34:43,,,,32.22,91.45,1243',
  ].join('\n');
  const readings = s.rowsToReadings(s.parseCsv(csv));
  assert.equal(readings.length, 1);
  assert.equal(readings[0].chamberId, 2);
});

test('a row without any usable time is skipped', () => {
  const csv = [
    'timestamp,temp1,humid1,tvoc1,temp2,humid2,tvoc2',
    ',32.27,91.85,3451,32.22,91.45,1243',
  ].join('\n');
  assert.equal(s.rowsToReadings(s.parseCsv(csv)).length, 0);
});

test('a Sheet row and its MQTT twin deduplicate on the same event id', async () => {
  const [sheetReading] = s.rowsToReadings(s.parseCsv(PHASE7));
  const store = createMemoryStore();

  const first = await ingestReading(
    {
      chamber_id: 1,
      sample_id: sheetReading.sampleId,
      sampled_at: sheetReading.sampledAt.toISOString(),
      tvoc: sheetReading.tvoc,
      suhu: sheetReading.suhu,
      rh: sheetReading.rh,
    },
    { receivedAt: sheetReading.receivedAt || RECEIVED, source: 'sheet' },
    store
  );
  assert.equal(first.duplicate, false);

  const second = await ingestReading(
    {
      event_id: sheetReading.eventId,
      sample_id: sheetReading.sampleId,
      chamber_id: 1,
      tvoc: sheetReading.tvoc,
      suhu: sheetReading.suhu,
      rh: sheetReading.rh,
      sampled_at: sheetReading.sampledAt.toISOString(),
    },
    { receivedAt: RECEIVED, source: 'mqtt' },
    store
  );
  assert.equal(second.duplicate, true);
  assert.equal(store.state.readings.length, 1);
  assert.deepEqual(store.state.readings[0].sources.sort(), ['mqtt', 'sheet']);
  assert.equal(store.state.readings[0].eventId, sheetReading.eventId);
});

test('legacy rows without identity are not given a fabricated event id', async () => {
  const [reading] = s.rowsToReadings(s.parseCsv(LEGACY));
  assert.equal(reading.eventId, null);

  const store = createMemoryStore();
  const payload = {
    chamber_id: 1,
    tvoc: reading.tvoc,
    suhu: reading.suhu,
    rh: reading.rh,
  };
  await ingestReading(payload, { receivedAt: reading.receivedAt, source: 'sheet' }, store);
  const again = await ingestReading(payload, { receivedAt: reading.receivedAt, source: 'sheet' }, store);
  assert.equal(again.duplicate, false, 'without identity there is nothing to deduplicate on');
  assert.equal(store.state.readings.length, 2);
  assert.equal(store.state.readings[0].eventId, null);
});

test('toCsvUrl preserves gid and the importer can detect an explicit tab', () => {
  assert.equal(
    s.toCsvUrl('https://docs.google.com/spreadsheets/d/ABC/edit#gid=123'),
    'https://docs.google.com/spreadsheets/d/ABC/export?format=csv&gid=123'
  );
  assert.equal(s.hasExplicitGid('https://docs.google.com/spreadsheets/d/ABC/edit#gid=123'), true);
  assert.equal(s.hasExplicitGid('https://docs.google.com/spreadsheets/d/ABC/export?format=csv'), false);
  assert.equal(s.hasExplicitGid('https://docs.google.com/spreadsheets/d/e/2PACX/pub?gid=0&single=true&output=csv'), true);
});
