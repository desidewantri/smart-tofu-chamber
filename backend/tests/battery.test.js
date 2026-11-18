const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBattery, batteryLevel } = require('../src/utils/battery');
const { validatePayload } = require('../src/services/ingestService');
const sheet = require('../src/services/sheetImportService');

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
