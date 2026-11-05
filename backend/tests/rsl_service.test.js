const test = require('node:test');
const assert = require('node:assert/strict');

const rsl = require('../src/services/rslService');

const NOW = new Date('2026-11-05T12:00:00.000Z');
const EXPERIMENT = {
  _id: 'exp-1',
  status: 'aktif',
  startedAt: new Date('2026-11-04T16:00:00.000Z'), // 20 h before NOW
  storageCondition: 'DRY',
};
const SESSION = {
  _id: 'ses-1',
  chamberId: 1,
  status: 'aktif',
  sampleStatus: 'NOT_SPOILED',
  storageCondition: 'DRY',
};

function enginePayload(overrides = {}) {
  return {
    success: true,
    data: {
      status: 'OK',
      primary_method: 'M1_EMPIRICAL_ENVELOPE',
      primary_rsl: {
        lower_h: 3.068924444444445,
        upper_h: 22.888799999999996,
        interpretation: 'EMPIRICAL_INTERVAL_ENVELOPE',
      },
      methods: {
        M1: { method: 'M1_EMPIRICAL_ENVELOPE', label: 'EMPIRICAL ENVELOPE', status: 'OK' },
        M2: {
          method: 'M2_TURNBULL_NPMLE',
          label: 'TURNBULL_NPMLE_CONDITIONAL_SUPPORT',
          status: 'OK',
          advisory: 'ESTIMATOR_DEPENDENT',
          note: 'support only',
          components: [
            { lower_h: 0, upper_h: 2.633924444444443, mass: 0.33333333333353543 },
            { lower_h: 11.1388, upper_h: 12.233195555555554, mass: 0.6666666666664646 },
          ],
        },
        M3: {
          method: 'M3_WEIBULL_A0',
          label: 'WEIBULL_A0_PARAMETRIC_COMPARATOR',
          status: 'OK',
          available: true,
          shape: 7.6967264161196045,
          scale: 30.757113200124557,
          r10_h: 0.5,
          r90_h: 12.5,
          support_warning: null,
          suppress_from_dashboard: false,
          note: 'comparator only',
        },
      },
      n_reference_sessions: 3,
      n_at_risk_sessions: 3,
      tvoc_contribution: 'NOT_ESTABLISHED',
      caveats: ['POST_HOC_EXPLORATORY'],
      ...overrides,
    },
    metadata: {
      engineVersion: '1.0.0',
      referenceVersion: 'v2.3-frozen-2026-11-04',
      referencePopulation: 3,
      referenceStorageCondition: 'DRY',
      researchStatus: 'POST_HOC_EXPLORATORY_DESCRIPTIVE',
    },
  };
}

function fakeFetch(handler) {
  return async (url, options) => {
    const result = await handler(url, options);
    return {
      ok: result.ok ?? true,
      status: result.status ?? 200,
      json: async () => result.body,
    };
  };
}

test('unknown operator sample status returns reference-only output without mutating stored status', async () => {
  let requestBody = null;
  const result = await rsl.estimateForSession(
    { experiment: EXPERIMENT, session: { ...SESSION, sampleStatus: 'UNKNOWN' }, now: NOW },
    {
      fetchImpl: fakeFetch((url, options) => {
        requestBody = JSON.parse(options.body);
        return { body: enginePayload() };
      }),
    }
  );
  assert.equal(result.status, 'REFERENCE_ONLY');
  assert.equal(result.referenceOnly, true);
  assert.equal(result.reason, 'SAMPLE_STATUS_UNKNOWN');
  assert.equal(result.sampleStatus, 'UNKNOWN');
  assert.ok(result.primary);
  // The engine has no UNKNOWN vocabulary; the adapter queries the DRY
  // reference explicitly while keeping the stored status UNKNOWN.
  assert.equal(requestBody.sampleStatus, 'NOT_SPOILED');
});

test('DRY + NOT_SPOILED maps canonical M1/M2/M3 and keeps full precision', async () => {
  let requestBody = null;
  const result = await rsl.estimateForSession(
    { experiment: EXPERIMENT, session: SESSION, now: NOW },
    {
      fetchImpl: fakeFetch((url, options) => {
        requestBody = JSON.parse(options.body);
        return { body: enginePayload() };
      }),
    }
  );
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.elapsedHours, 20);
  assert.equal(result.primary.lowerHours, 3.068924444444445);
  assert.equal(result.primary.upperHours, 22.888799999999996);
  assert.deepEqual(result.primary.display, { lowerHours: 3, upperHours: 23 });
  assert.equal(result.supporting.M2.components[0].mass, 0.33333333333353543);
  assert.equal(result.supporting.M3.r90Hours, 12.5);
  assert.equal(result.metadata.engineVersion, '1.0.0');
  assert.deepEqual(requestBody, {
    elapsedHours: 20,
    sampleStatus: 'NOT_SPOILED',
    storageCondition: 'DRY',
  });
  assert.equal('tvoc' in requestBody, false);
  assert.equal('suhu' in requestBody, false);
  assert.equal('rh' in requestBody, false);
});

test('SPOILED suppresses the normal range without fabricating values', async () => {
  const result = await rsl.estimateForSession(
    { experiment: EXPERIMENT, session: { ...SESSION, sampleStatus: 'SPOILED' }, now: NOW },
    {
      fetchImpl: fakeFetch(() => ({
        body: enginePayload({ status: 'SAMPLE_REPORTED_SPOILED', primary_rsl: { lower_h: null, upper_h: null, interpretation: 'NO_RANGE_SAMPLE_REPORTED_SPOILED' } }),
      })),
    }
  );
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.reason, 'SAMPLE_REPORTED_SPOILED');
  assert.equal(result.primary, null);
});

test('WATER returns explicit unsupported condition without calling the engine', async () => {
  let called = 0;
  const result = await rsl.estimateForSession(
    { experiment: EXPERIMENT, session: { ...SESSION, storageCondition: 'WATER' }, now: NOW },
    { fetchImpl: fakeFetch(() => { called += 1; return { body: enginePayload() }; }) }
  );
  assert.equal(result.reason, 'UNSUPPORTED_STORAGE_CONDITION');
  assert.equal(called, 0);
});

test('outside support keeps M2/M3 but has no primary range', async () => {
  const result = await rsl.estimateForSession(
    { experiment: EXPERIMENT, session: SESSION, now: NOW },
    {
      fetchImpl: fakeFetch(() => ({
        body: enginePayload({
          status: 'OUTSIDE_SUPPORT',
          primary_rsl: { lower_h: null, upper_h: null, interpretation: 'NO_RANGE_OUTSIDE_SUPPORT' },
          methods: {
            M1: { status: 'OUTSIDE_SUPPORT', lower_h: null, upper_h: null },
            M2: { status: 'OUTSIDE_SUPPORT', components: [] },
            M3: { status: 'OUTSIDE_SUPPORT', available: false, r10_h: null, r90_h: null },
          },
        }),
      })),
    }
  );
  assert.equal(result.reason, 'OUTSIDE_REFERENCE_SUPPORT');
  assert.equal(result.primary, null);
  assert.equal(result.supporting.M2.status, 'OUTSIDE_SUPPORT');
});

test('engine timeout becomes an explicit unavailable result, not a stale estimate', async () => {
  const result = await rsl.estimateForSession(
    { experiment: EXPERIMENT, session: SESSION, now: NOW },
    {
      fetchImpl: async () => {
        const err = new Error('timeout');
        err.name = 'TimeoutError';
        throw err;
      },
    }
  );
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.reason, 'RSL_TIMEOUT');
  assert.equal(result.primary, null);
});

test('connection refusal is an explicit unavailable state', async () => {
  const result = await rsl.estimateForSession(
    { experiment: EXPERIMENT, session: SESSION, now: NOW },
    {
      fetchImpl: async () => {
        const err = new TypeError('fetch failed');
        err.cause = { code: 'ECONNREFUSED' };
        throw err;
      },
    }
  );
  assert.equal(result.reason, 'RSL_UNAVAILABLE');
  assert.equal(result.primary, null);
});

test('malformed engine response is rejected', async () => {
  const result = await rsl.estimateForSession(
    { experiment: EXPERIMENT, session: SESSION, now: NOW },
    { fetchImpl: fakeFetch(() => ({ body: { success: true, data: null } })) }
  );
  assert.equal(result.reason, 'ENGINE_INVALID_RESPONSE');
  assert.equal(result.primary, null);
});

test('negative elapsed time is unavailable and never converted to a positive estimate', async () => {
  let called = 0;
  const future = { ...EXPERIMENT, startedAt: new Date('2026-11-06T12:00:00.000Z') };
  const result = await rsl.estimateForSession(
    { experiment: future, session: SESSION, now: NOW },
    { fetchImpl: fakeFetch(() => { called += 1; return { body: enginePayload() }; }) }
  );
  assert.equal(result.reason, 'NEGATIVE_ELAPSED_TIME');
  assert.equal(called, 0);
});

test('snapshot capture can opt into an early-closed chamber session', async () => {
  let called = 0;
  const result = await rsl.estimateForSession(
    {
      experiment: EXPERIMENT,
      session: { ...SESSION, status: 'selesai' },
      now: NOW,
      allowClosed: true,
    },
    {
      fetchImpl: fakeFetch(() => {
        called += 1;
        return { body: enginePayload() };
      }),
    }
  );
  assert.equal(called, 1);
  assert.equal(result.status, 'AVAILABLE');
});

test('closed experiment and inactive session are explicit', async () => {
  const closed = await rsl.estimateForSession(
    { experiment: { ...EXPERIMENT, status: 'selesai' }, session: SESSION, now: NOW },
    { fetchImpl: fakeFetch(() => ({ body: enginePayload() })) }
  );
  assert.equal(closed.reason, 'EXPERIMENT_CLOSED');
  const inactive = await rsl.estimateForSession(
    { experiment: EXPERIMENT, session: { ...SESSION, status: 'selesai' }, now: NOW },
    { fetchImpl: fakeFetch(() => ({ body: enginePayload() })) }
  );
  assert.equal(inactive.reason, 'NO_ACTIVE_SESSION');
});

test('status and storage validation reject unknown vocabulary', () => {
  assert.equal(rsl.validateSampleStatus('not_spoiled'), 'NOT_SPOILED');
  assert.throws(() => rsl.validateSampleStatus('MAYBE'), /sampleStatus/);
  assert.equal(rsl.validateStorageCondition('dry'), 'DRY');
  assert.throws(() => rsl.validateStorageCondition('COLD'), /storageCondition/);
});
