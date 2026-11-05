const test = require('node:test');
const assert = require('node:assert/strict');

const rsl = require('../src/services/rslService');

const NOW = new Date('2026-11-05T12:00:00.000Z');
const EXPERIMENT = {
  _id: 'exp-1',
  status: 'aktif',
  startedAt: new Date('2026-11-04T16:00:00.000Z'),
  storageCondition: 'DRY',
};

function enginePayload() {
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
          components: [{ lower_h: 0, upper_h: 2.6, mass: 0.33 }],
        },
        M3: {
          method: 'M3_WEIBULL_A0',
          label: 'WEIBULL_A0_PARAMETRIC_COMPARATOR',
          status: 'OK',
          available: true,
          shape: 7.6,
          scale: 30.7,
          r10_h: 0.5,
          r90_h: 12.5,
          support_warning: null,
          suppress_from_dashboard: false,
        },
      },
      n_reference_sessions: 3,
      n_at_risk_sessions: 3,
      tvoc_contribution: 'NOT_ESTABLISHED',
      caveats: ['POST_HOC_EXPLORATORY'],
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
    return { ok: true, status: 200, json: async () => result.body };
  };
}

test('UNKNOWN returns an explicit reference-only range without mutating stored status', async () => {
  let requestBody = null;
  const result = await rsl.estimateForSession(
    {
      experiment: EXPERIMENT,
      session: { _id: 'ses-1', chamberId: 1, status: 'aktif', sampleStatus: 'UNKNOWN', storageCondition: 'DRY' },
      now: NOW,
    },
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
  assert.equal(result.primary.lowerHours, 3.068924444444445);
  assert.ok(result.supporting.M2);
  assert.ok(result.supporting.M3);
  assert.equal(result.metadata.referenceVersion, 'v2.3-frozen-2026-11-04');
  // Engine never sees UNKNOWN; the adapter queries the DRY reference explicitly.
  assert.equal(requestBody.sampleStatus, 'NOT_SPOILED');
});

test('NOT_SPOILED still returns an individualized AVAILABLE result', async () => {
  const result = await rsl.estimateForSession(
    {
      experiment: EXPERIMENT,
      session: { _id: 'ses-1', chamberId: 1, status: 'aktif', sampleStatus: 'NOT_SPOILED', storageCondition: 'DRY' },
      now: NOW,
    },
    { fetchImpl: fakeFetch(() => ({ body: enginePayload() })) }
  );
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.referenceOnly || false, false);
  assert.equal(result.sampleStatus, 'NOT_SPOILED');
  assert.ok(result.primary);
});

test('SPOILED hides the primary range but keeps supporting detail', async () => {
  const result = await rsl.estimateForSession(
    {
      experiment: EXPERIMENT,
      session: { _id: 'ses-1', chamberId: 1, status: 'aktif', sampleStatus: 'SPOILED', storageCondition: 'DRY' },
      now: NOW,
    },
    {
      fetchImpl: fakeFetch(() => ({
        body: {
          success: true,
          data: {
            status: 'SAMPLE_REPORTED_SPOILED',
            primary_rsl: { lower_h: null, upper_h: null, interpretation: 'NO_RANGE' },
            methods: { M2: { status: 'OK', components: [] }, M3: { status: 'OK', available: false } },
            n_reference_sessions: 0,
            n_at_risk_sessions: 0,
            tvoc_contribution: 'NOT_ESTABLISHED',
            caveats: [],
          },
          metadata: { engineVersion: '1.0.0', referenceVersion: 'v2.3-frozen-2026-11-04', referencePopulation: 3, referenceStorageCondition: 'DRY' },
        },
      })),
    }
  );
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.reason, 'SAMPLE_REPORTED_SPOILED');
  assert.equal(result.primary, null);
});
