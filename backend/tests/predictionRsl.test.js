const test = require('node:test');
const assert = require('node:assert/strict');
const { predictRsl } = require('../src/services/predictionService');

const input = {
  sessionMongoId: '6aecf045b815042fcde98792',
  monitoringStartAt: new Date('2026-11-18T01:00:00Z'),
  currentTimestamp: new Date('2026-11-18T03:00:00Z'),
  tempC: 27.4, humidPct: 78.9, connected: true,
};
const fake = (over) => ({ estimate: async () => ({
  applicationState: 'ESTIMATE_AVAILABLE', domainStatus: 'WITHIN_DOMAIN', failureCategory: 'NONE',
  researchDisplayEligible: true, medianRslHours: 31.4567, pi80LowerHours: 28.1, pi80UpperHours: 35,
  lastCalculatedAt: new Date('2026-11-18T03:00:02Z'), ...over,
}) });

test('in-domain memakai median', async () => {
  const r = await predictRsl(input, fake());
  assert.equal(r.shelfLifeJam, 31.46);
  assert.equal(r.rslDomain, 'IN_DOMAIN');
  assert.equal(r.modelUsed, 'v21_weibull');
  assert.equal(r.source, 'live');
});

test('di luar domain -> null, bukan 0', async () => {
  const r = await predictRsl(input, fake({ domainStatus: 'BEYOND_DOMAIN', failureCategory: 'OUT_OF_DOMAIN', researchDisplayEligible: false, medianRslHours: null, pi80LowerHours: null, pi80UpperHours: null }));
  assert.equal(r.shelfLifeJam, null);
  assert.equal(r.rslDomain, 'OUT_OF_DOMAIN');
});

test('belum cukup data -> null, domain null', async () => {
  const r = await predictRsl(input, fake({ applicationState: 'WAITING_FOR_DATA', failureCategory: 'INSUFFICIENT_EVIDENCE', researchDisplayEligible: false, medianRslHours: null }));
  assert.equal(r.shelfLifeJam, null);
  assert.equal(r.rslDomain, null);
  assert.equal(r.rslState, 'WAITING_FOR_DATA');
});

test('median ada tapi display tidak eligible -> angka disembunyikan', async () => {
  const r = await predictRsl(input, fake({ researchDisplayEligible: false }));
  assert.equal(r.shelfLifeJam, null);
});

test('error service diteruskan sebagai error', async () => {
  await assert.rejects(predictRsl(input, { estimate: async () => { throw new Error('timeout'); } }), /timeout/);
});
