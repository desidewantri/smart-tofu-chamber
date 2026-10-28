const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyShelfLife, classifyParam, remainingSeconds, STATUS } = require('../src/utils/status');
const { baseTslHours, predictMock } = require('../src/utils/mlMock');

test('zona status mengikuti batas 24 jam dan 8 jam', () => {
  assert.equal(classifyShelfLife(30), STATUS.LAYAK);
  assert.equal(classifyShelfLife(24.01), STATUS.LAYAK);
  assert.equal(classifyShelfLife(24), STATUS.SEGERA);
  assert.equal(classifyShelfLife(8), STATUS.SEGERA);
  assert.equal(classifyShelfLife(7.99), STATUS.TIDAK);
  assert.equal(classifyShelfLife(null), null);
});

test('zona status memakai batas kustom dari Settings', () => {
  assert.equal(classifyShelfLife(20, { segarHours: 18, rawanHours: 6 }), STATUS.LAYAK);
  assert.equal(classifyShelfLife(5, { segarHours: 18, rawanHours: 6 }), STATUS.TIDAK);
});

test('zona parameter sensor', () => {
  const lim = { aman: 200, perhatian: 400 };
  assert.equal(classifyParam(150, lim), 'Aman');
  assert.equal(classifyParam(200, lim), 'Aman');
  assert.equal(classifyParam(300, lim), 'Perhatian');
  assert.equal(classifyParam(401, lim), 'Bahaya');
});

test('sisa waktu = T_sl*3600 - (sekarang - t0), tidak negatif', () => {
  const t0 = new Date('2026-05-24T08:00:00Z');
  const s = { shelfLifeAwal: 2, prediksiDibuat: t0 };
  assert.equal(remainingSeconds(s, t0.getTime()), 7200);
  assert.equal(remainingSeconds(s, t0.getTime() + 3600 * 1000), 3600);
  assert.equal(remainingSeconds(s, t0.getTime() + 5 * 3600 * 1000), 0);
  assert.equal(remainingSeconds({ shelfLifeAwal: null }, Date.now()), null);
});

test('mock: titik tabel literatur terpenuhi dan makin panas makin pendek', () => {
  assert.ok(Math.abs(baseTslHours(20) - 24) < 0.01);
  assert.ok(Math.abs(baseTslHours(30) - 8) < 0.01);
  assert.ok(baseTslHours(15) < baseTslHours(10));
  assert.ok(baseTslHours(27) < baseTslHours(22));
});

test('predictMock: tahu baru, umur simpan dari suhu (lebih panas = lebih singkat)', () => {
  const at30 = predictMock({ tvoc: 400, suhu: 30, rh: 90 }).shelfLifeJam;
  assert.ok(Math.abs(at30 - 32) < 0.01);
  assert.ok(predictMock({ tvoc: 400, suhu: 32, rh: 90 }).shelfLifeJam < at30);
  assert.ok(predictMock({ tvoc: 400, suhu: 28, rh: 90 }).shelfLifeJam > at30);
  assert.equal(predictMock({ tvoc: 1, suhu: 25, rh: 70 }).modelUsed, 'mock');
});

test('predictMock: TVOC tinggi di awal (pemanasan sensor) tidak membuat tahu baru "tidak layak"', () => {
  const r = predictMock({ tvoc: 2700, suhu: 29.5, rh: 90, features: { hours: 0.5, tvocBaseline: 2700, tempMean: 29.5, readings: 6 } });
  assert.ok(r.shelfLifeJam > 24);
});

test('predictMock: kenaikan TVOC relatif terhadap baseline menurunkan sisa umur', () => {
  const f = (tvoc) => predictMock({ tvoc, suhu: 30, rh: 90, features: { hours: 20, tvocBaseline: 400, tempMean: 30, readings: 200 } }).shelfLifeJam;
  assert.ok(Math.abs(f(800) - 12) < 0.01); // rasio 2: belum onset, masih ikut suhu (32 - 20)
  assert.ok(f(4000) < 6); // rasio 10: sudah onset
  assert.equal(f(30000), 0); // rasio 75: tidak layak
});
