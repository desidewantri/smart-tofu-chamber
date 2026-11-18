const test = require('node:test');
const assert = require('node:assert/strict');
const { sessionView } = require('../src/utils/presenters');

const doc = { _id: 'x', sesiCode: 'CH-013', chamberId: 1, status: 'aktif', masuk: new Date('2026-11-18T01:00:00Z'),
  shelfLifeAwal: 31.46, prediksiDibuat: new Date('2026-11-18T03:00:00Z'), rslDomain: 'IN_DOMAIN',
  rslState: 'ESTIMATE_AVAILABLE', rslPi80Low: 28.1, rslPi80High: 35, legacy: false };

test('statusLayak dinetralkan saat neutralStatus', () => {
  const v = sessionView(doc, { segarHours: 24, rawanHours: 8 }, new Date('2026-11-18T03:00:00Z').getTime(), { neutralStatus: true });
  assert.equal(v.statusLayak, null);
  assert.equal(v.rslDomain, 'IN_DOMAIN');
  assert.deepEqual(v.rslPi80, { low: 28.1, high: 35 });
  assert.equal(v.legacy, false);
});

test('statusLayak tetap dihitung saat tidak netral', () => {
  const v = sessionView(doc, { segarHours: 24, rawanHours: 8 }, new Date('2026-11-18T03:00:00Z').getTime(), { neutralStatus: false });
  assert.equal(v.statusLayak, 'Layak Konsumsi');
});

test('sesi legacy ditandai', () => {
  const v = sessionView({ ...doc, legacy: true, rslDomain: 'LEGACY' }, undefined, Date.now(), { neutralStatus: true });
  assert.equal(v.legacy, true);
  assert.equal(v.rslDomain, 'LEGACY');
});
