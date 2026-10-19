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

test('mock: TVOC tinggi dan RH tinggi memperpendek shelf-life', () => {
  const a = predictMock({ tvoc: 120, suhu: 25, rh: 70 }).shelfLifeJam;
  const b = predictMock({ tvoc: 600, suhu: 25, rh: 70 }).shelfLifeJam;
  const c = predictMock({ tvoc: 120, suhu: 25, rh: 90 }).shelfLifeJam;
  assert.ok(b < a);
  assert.ok(c < a);
  assert.equal(predictMock({ tvoc: 1, suhu: 25, rh: 70 }).modelUsed, 'mock');
});
