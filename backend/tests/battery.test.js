const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBattery, batteryLevel } = require('../src/utils/battery');
const { validatePayload } = require('../src/services/ingestService');
const sheet = require('../src/services/sheetImportService');
const { batteryStatus } = require('../src/controllers/dashboardController');
const { createMemoryStore } = require('./helpers/memoryStore');
const { ingestReading } = require('../src/services/ingestService');
const env = require('../src/config/env');

test('parseBattery menerima angka/teks dan membatasi 0-100', () => {
  assert.equal(parseBattery(72), 72);
  assert.equal(parseBattery('64%'), 64);
  assert.equal(parseBattery('55,6'), 56);
  assert.equal(parseBattery(130), 100);
  assert.equal(parseBattery(-3), null);
  assert.equal(parseBattery(76.47), 76);
  assert.equal(parseBattery(3.94), 69); // vbat dalam volt
  assert.equal(parseBattery(4.2), 100);
  assert.equal(parseBattery(3.2), 0);
  assert.equal(parseBattery(18.79), 19); // target Sheet vbat is percent
  assert.equal(parseBattery(7.26), 7);
  assert.equal(parseBattery(5), 100); // boundary: 5 V is still voltage
  assert.equal(parseBattery(5.01), 5); // above boundary: percent
  assert.equal(parseBattery(0), 0);
  assert.equal(parseBattery(100), 100);
  assert.equal(parseBattery(''), null);
  assert.equal(parseBattery('x'), null);
});

test('batteryLevel: baik > 50, sedang 20-50, lemah < 20', () => {
  assert.equal(batteryLevel(72), 'baik');
  assert.equal(batteryLevel(50), 'sedang');
  assert.equal(batteryLevel(20), 'sedang');
  assert.equal(batteryLevel(19), 'lemah');
  assert.equal(batteryLevel(null), null);
});

test('validatePayload membaca battery (opsional)', () => {
  assert.equal(validatePayload({ chamber_id: 1, tvoc: 300, suhu: 25, rh: 70, battery: 81 }).battery, 81);
  assert.equal(validatePayload({ chamber_id: 1, tvoc: 300, suhu: 25, rh: 70 }).battery, null);
  assert.equal(validatePayload({ chamber_id: 1, tvoc: 300, suhu: 25, rh: 70, vbat: 18.79 }).battery, 19);
  assert.equal(validatePayload({ chamber_id: 1, tvoc: 300, suhu: 25, rh: 70, vbat: 3.94 }).battery, 69);
});

test('Sheet: kolom battery dipakai untuk kedua chamber', () => {
  const csv = 'timestamp,temp1,humid1,tvoc1,temp2,humid2,tvoc2,battery\n10/22/2026 21:34:43,32,91,3451,32,91,1243,87%\n';
  const r = sheet.rowsToReadings(sheet.parseCsv(csv));
  assert.deepEqual(r.map((x) => x.battery), [87, 87]);
});

test('Sheet: kolom vbat (volt atau persen) terbaca', () => {
  const csv = 'timestamp,temp1,humid1,tvoc1,temp2,humid2,tvoc2,vbat\n10/27/2026 18:06:06,24.57,62.69,432,24.18,63.24,70,3.94\n10/27/2026 19:01:51,24.73,71.93,386,24.68,71.83,67,76.47\n';
  const r = sheet.rowsToReadings(sheet.parseCsv(csv));
  assert.deepEqual(r.map((x) => x.battery), [69, 69, 76, 76]);
});

test('batteryStatus memakai laporan baterai terbaru antar chamber', async () => {
  const store = createMemoryStore({ chambers: [], readings: [], sessions: [], predictions: [], experiments: [], rslSnapshots: [], notificationEvents: [], seq: 0, ids: 0, calls: {} });
  store.state.chambers.push(
    { _id: 'c1', chamberId: 1, battery: 69, batteryAt: new Date('2026-11-06T00:00:00Z') },
    { _id: 'c2', chamberId: 2, battery: 78, batteryAt: new Date('2026-11-06T00:05:00Z') }
  );
  const realChamber = require('../src/models/Chamber');
  const origFindOne = realChamber.findOne;
  realChamber.findOne = (...args) => store.models.Chamber.findOne(...args);
  const settings = { updateIntervalMinutes: 5 };
  try {
    const status = await batteryStatus(settings, new Date('2026-11-06T00:06:00Z').getTime());
    assert.equal(status.percent, 78);
    assert.equal(status.chamberId, 2);
    assert.equal(status.stale, false);
  } finally {
    realChamber.findOne = origFindOne;
  }
});

test('batteryStatus jujur saat tidak ada data atau data stale', async () => {
  const realChamber = require('../src/models/Chamber');
  const origFindOne = realChamber.findOne;
  const empty = createMemoryStore({ chambers: [], readings: [], sessions: [], predictions: [], experiments: [], rslSnapshots: [], notificationEvents: [], seq: 0, ids: 0, calls: {} });
  realChamber.findOne = (...args) => empty.models.Chamber.findOne(...args);
  try {
    const none = await batteryStatus({ updateIntervalMinutes: 5 }, Date.now());
    assert.equal(none.percent, null);
    assert.equal(none.at, null);
  } finally {
    realChamber.findOne = origFindOne;
  }
  const stale = createMemoryStore({ chambers: [], readings: [], sessions: [], predictions: [], experiments: [], rslSnapshots: [], notificationEvents: [], seq: 0, ids: 0, calls: {} });
  stale.state.chambers.push({ _id: 'c1', chamberId: 1, battery: 69, batteryAt: new Date('2026-11-01T00:00:00Z') });
  realChamber.findOne = (...args) => stale.models.Chamber.findOne(...args);
  try {
    const old = await batteryStatus({ updateIntervalMinutes: 5 }, new Date('2026-11-06T00:00:00Z').getTime());
    assert.equal(old.percent, 69);
    assert.equal(old.stale, true);
  } finally {
    realChamber.findOne = origFindOne;
  }
});

test('ingest menyimpan baterai dari vbat tiap pengiriman, termasuk ML_MODE=off', async () => {
  const oldMode = env.ml.mode;
  for (const mode of ['mock', 'off']) {
    env.ml.mode = mode;
    try {
      const store = createMemoryStore();
      const result = await ingestReading(
        { chamber_id: 1, tvoc: 100, suhu: 27.5, rh: 78, vbat: 3.94, sampled_at: '2026-11-06T00:00:00Z' },
        { source: 'mqtt', receivedAt: new Date('2026-11-06T00:01:00Z') },
        store
      );
      assert.equal(result.reading.battery, 69);
      assert.equal(store.state.readings[0].battery, 69);
    } finally {
      env.ml.mode = oldMode;
    }
  }
});
