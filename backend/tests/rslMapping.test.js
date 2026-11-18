const test = require('node:test');
const assert = require('node:assert/strict');
const { RSL_DOMAIN, deriveRslDomain, sessionRslFields } = require('../src/utils/rslMapping');

test('deriveRslDomain: dalam domain termasuk AT_BOUNDARY', () => {
  assert.equal(deriveRslDomain({ domainStatus: 'WITHIN_DOMAIN', failureCategory: 'NONE' }), RSL_DOMAIN.IN);
  assert.equal(deriveRslDomain({ domainStatus: 'AT_BOUNDARY', failureCategory: 'NONE' }), RSL_DOMAIN.IN);
  assert.equal(deriveRslDomain({ domainStatus: 'BEYOND_DOMAIN', failureCategory: 'OUT_OF_DOMAIN' }), RSL_DOMAIN.OUT);
  assert.equal(deriveRslDomain({ domainStatus: 'INVALID_ELAPSED_TIME', failureCategory: 'INPUT_TIMESTAMP' }), null);
});

const calc = new Date('2026-11-18T03:00:02Z');

test('in-domain: prediksiDibuat dari last_calculated_at', () => {
  const f = sessionRslFields({ shelfLifeJam: 31.4567, rslDomain: RSL_DOMAIN.IN, rslState: 'ESTIMATE_AVAILABLE',
    rslPi80Low: 28.1, rslPi80High: 35, rslCalculatedAt: calc }, { previous: { prediksiDibuat: new Date('2020-01-01') } });
  assert.equal(f.shelfLifeAwal, 31.46);
  assert.equal(f.prediksiDibuat.toISOString(), calc.toISOString());
  assert.equal(f.modelUsed, 'v21_weibull');
  assert.equal(f.rslDomain, RSL_DOMAIN.IN);
});

test('out-of-domain: shelfLifeAwal null, bukan 0', () => {
  const f = sessionRslFields({ shelfLifeJam: null, rslDomain: RSL_DOMAIN.OUT, rslState: 'PROCESSING_FAILED',
    rslPi80Low: null, rslPi80High: null, rslCalculatedAt: calc }, { previous: {} });
  assert.equal(f.shelfLifeAwal, null);
  assert.notEqual(f.shelfLifeAwal, 0);
  assert.equal(f.rslDomain, RSL_DOMAIN.OUT);
});

test('belum ada estimasi: prediksiDibuat lama dipertahankan', () => {
  const prev = new Date('2026-11-18T02:00:00Z');
  const f = sessionRslFields({ shelfLifeJam: null, rslDomain: null, rslState: 'WAITING_FOR_DATA',
    rslPi80Low: null, rslPi80High: null, rslCalculatedAt: null }, { previous: { prediksiDibuat: prev } });
  assert.equal(f.shelfLifeAwal, null);
  assert.equal(f.prediksiDibuat.toISOString(), prev.toISOString());
});

test('timestamp tidak valid: prediksiDibuat tidak mundur, angka disembunyikan', () => {
  const prev = new Date('2026-11-18T02:00:00Z');
  const f = sessionRslFields({ shelfLifeJam: null, rslDomain: null, rslState: 'ACTION_REQUIRED',
    rslPi80Low: null, rslPi80High: null, rslCalculatedAt: null }, { previous: { prediksiDibuat: prev } });
  assert.equal(f.shelfLifeAwal, null);
  assert.equal(f.prediksiDibuat.toISOString(), prev.toISOString());
});
