const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../src/services/sheetImportService');

const CSV = [
  'timestamp,temp1,humid1,tvoc1,temp2,humid2,tvoc2,label,,',
  '10/22/2026 21:34:43,32.27,91.85,3451,32.22,91.45,1243,,-16,',
  ',,,,,,,,,Knp pula matlis',
  '10/23/2026 0:01:18,32.15,91.96,2516,32.12,91.46,901,,,',
  '"10/23/2026 0:06:25","32,13","91,94",2485,,,,,,',
].join('\r\n');

test('parseTimestamp membaca format Sheet (WIB) menjadi UTC', () => {
  assert.equal(s.parseTimestamp('10/22/2026 21:34:43').toISOString(), '2026-10-22T14:34:43.000Z');
  assert.equal(s.parseTimestamp('10/23/2026 0:01:18').toISOString(), '2026-10-22T17:01:18.000Z');
  assert.equal(s.parseTimestamp('22/10/2026 21:34', { order: 'dmy' }).toISOString(), '2026-10-22T14:34:00.000Z');
  assert.equal(s.parseTimestamp('2026-10-22 21:34:43').toISOString(), '2026-10-22T14:34:43.000Z');
  assert.equal(s.parseTimestamp(''), null);
});

test('rowsToReadings memetakan kolom 1 ke Chamber 1 dan kolom 2 ke Chamber 2', () => {
  const r = s.rowsToReadings(s.parseCsv(CSV));
  assert.equal(r.length, 5); // 2 + 2 + 1 (baris terakhir chamber 2 kosong), baris catatan dilewati
  const c1 = r.filter((x) => x.chamberId === 1);
  assert.deepEqual(c1.map((x) => x.tvoc), [3451, 2516, 2485]);
  assert.equal(c1[2].suhu, 32.13);
  assert.equal(r.filter((x) => x.chamberId === 2).length, 2);
});

test('toCsvUrl mengubah link Sheet biasa menjadi link unduhan CSV', () => {
  assert.equal(
    s.toCsvUrl('https://docs.google.com/spreadsheets/d/ABC_123-x/edit?gid=359910033#gid=359910033'),
    'https://docs.google.com/spreadsheets/d/ABC_123-x/export?format=csv&gid=359910033'
  );
  const pub = 'https://docs.google.com/spreadsheets/d/e/2PACX-1/pub?gid=0&single=true&output=csv';
  assert.equal(s.toCsvUrl(pub), pub);
});
