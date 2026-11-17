const test = require('node:test');
const assert = require('node:assert/strict');
const { createRslClient } = require('../src/services/rslClient');

const okBody = {
  session_id: 's1', application_state: 'ESTIMATE_AVAILABLE', domain_status: 'WITHIN_DOMAIN',
  failure_category: 'NONE', research_display_eligible: true,
  estimate: { median_rsl_hours: 31.4567, pi80_lower_hours: 28.1, pi80_upper_hours: 35.0 },
  last_calculated_at: '2026-11-18T03:00:02+00:00',
  headline_id: 'Perkiraan sisa waktu pemantauan (estimasi riset): sekitar 31.5 jam.',
  research_disclaimer_id: 'Perkiraan ini dihasilkan berdasarkan model penelitian TofuSense.',
  operational_prediction_authorized: false,
};

const client = (impl) => createRslClient({ url: 'http://rsl:8001', timeoutMs: 1000, fetchImpl: impl });

test('memetakan respons rsl ke bentuk camelCase', async () => {
  const res = await client(async () => new Response(JSON.stringify(okBody), { status: 200 })).estimate({
    sessionId: 's1', startAt: new Date('2026-11-18T01:00:00Z'), now: new Date('2026-11-18T03:00:00Z'),
  });
  assert.equal(res.medianRslHours, 31.4567);
  assert.equal(res.domainStatus, 'WITHIN_DOMAIN');
  assert.equal(res.lastCalculatedAt.toISOString(), '2026-11-18T03:00:02.000Z');
});

test('mengirim monitoring_start_at tanpa fitur sensor', async () => {
  let sent;
  await client(async (_url, opts) => { sent = JSON.parse(opts.body); return new Response(JSON.stringify(okBody), { status: 200 }); })
    .estimate({ sessionId: 's1', startAt: new Date('2026-11-18T01:00:00Z'), now: new Date('2026-11-18T03:00:00Z'), tempC: 27.4 });
  assert.equal(sent.monitoring_start_at, '2026-11-18T01:00:00.000Z');
  assert.equal(sent.temp_c, 27.4);
  assert.equal(sent.tvoc, undefined);
  assert.equal(sent.suhu, undefined);
  assert.equal(sent.rh, undefined);
});

test('menolak HTTP 500', async () => {
  await assert.rejects(
    client(async () => new Response('boom', { status: 500 })).estimate({ sessionId: 's1', startAt: new Date(), now: new Date() }),
    /rsl/i
  );
});

test('menolak body tanpa estimate', async () => {
  await assert.rejects(
    client(async () => new Response(JSON.stringify({ application_state: 'X' }), { status: 200 })).estimate({ sessionId: 's1', startAt: new Date(), now: new Date() }),
    /rsl/i
  );
});

test('last_calculated_at null tetap null', async () => {
  const body = { ...okBody, last_calculated_at: null };
  const res = await client(async () => new Response(JSON.stringify(body), { status: 200 })).estimate({ sessionId: 's1', startAt: new Date(), now: new Date() });
  assert.equal(res.lastCalculatedAt, null);
});
