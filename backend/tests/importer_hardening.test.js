const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const s = require('../src/services/sheetImportService');
const { ingestReading } = require('../src/services/ingestService');
const { createMemoryStore } = require('./helpers/memoryStore');

const HEADER = 'timestamp,temp1,humid1,tvoc1';
const ROW = '10/22/2026 21:34:43,27.5,79,88';
const CSV = [HEADER, ROW].join('\n');

function makeState() {
  return { cursor: {}, receipts: {}, ingested: 0 };
}

function makeModels(state) {
  const ImportCursor = {
    async findOne({ key }) {
      return state.cursor[key] || null;
    },
    async findOneAndUpdate(filter, update, opts = {}) {
      let doc = state.cursor[filter.key];
      const now = Date.now();
      if (doc && doc.leaseUntil && new Date(doc.leaseUntil).getTime() > now && doc.leaseOwner) {
        return null;
      }
      if (!doc && opts.upsert) {
        doc = { key: filter.key, ...(update.$setOnInsert || {}) };
      }
      if (!doc) return null;
      Object.assign(doc, update.$set || {});
      state.cursor[filter.key] = doc;
      return doc;
    },
    async updateOne({ key }, update) {
      state.cursor[key] = { key, ...(state.cursor[key] || {}), ...(update.$set || {}) };
      return { acknowledged: true };
    },
  };

  const ImportReceipt = {
    async findOne(filter) {
      if (filter.key) return state.receipts[filter.key] || null;
      if (filter.rowFingerprint) {
        return Object.values(state.receipts).find((r) =>
          r.rowFingerprint === filter.rowFingerprint &&
          (filter.sourceId === undefined || r.sourceId === filter.sourceId) &&
          (filter.chamberId === undefined || r.chamberId === filter.chamberId)
        ) || null;
      }
      return null;
    },
    async updateOne({ key }, update) {
      const previous = state.receipts[key] || {};
      state.receipts[key] = {
        key,
        ...previous,
        ...(update.$set || {}),
      };
      if (state.receipts[key].attempts === undefined && update.$setOnInsert) {
        state.receipts[key].attempts = update.$setOnInsert.attempts || 0;
      }
    },
  };

  const Chamber = { async updateOne() {} };
  return { ImportCursor, ImportReceipt, Chamber };
}

async function run(csv = CSV, overrides = {}) {
  const state = makeState();
  const models = makeModels(state);
  const ingest =
    overrides.ingest ||
    (async () => {
      state.ingested += 1;
      return { duplicate: false, session: { experimentId: 'exp-1' } };
    });
  const counts = await s.processRows(s.parseCsv(csv), {
    sourceId: 'test:0',
    mode: 'fallback',
    models,
    ingest,
    alreadyStoredFn: overrides.alreadyStoredFn || (async () => false),
    cutoff: overrides.cutoff || null,
    since: null,
  });
  return { state, models, counts };
}

test('successful row advances cursor and records IMPORTED receipt', async () => {
  const { state, counts } = await run();
  assert.equal(counts.imported, 1);
  assert.equal(state.cursor['sheet:test:0:1'].lastRowIndex, 0);
  const receipt = state.receipts['sheet:test:0:0:ch1'];
  assert.equal(receipt.status, 'IMPORTED');
  assert.equal(receipt.eventId, null);
  assert.equal(receipt.sampleId, null);
  assert.equal(receipt.rawRow[0], '10/22/2026 21:34:43');
});

test('one row imports both chambers with separate receipt identities', async () => {
  const csv = [
    'timestamp,temp1,humid1,tvoc1,temp2,humid2,tvoc2',
    '10/22/2026 21:34:43,27.5,79,88,27.5,77,111',
  ].join('\n');
  const state = makeState();
  const models = makeModels(state);
  let calls = 0;
  const counts = await s.processRows(s.parseCsv(csv), {
    sourceId: 'test:both',
    mode: 'primary',
    models,
    ingest: async () => {
      calls += 1;
      return { duplicate: false, session: { experimentId: 'exp-1' } };
    },
    alreadyStoredFn: async () => false,
  });
  assert.equal(counts.imported, 2);
  assert.equal(calls, 2);
  assert.equal(state.receipts['sheet:test:both:0:ch1'].chamberId, 1);
  assert.equal(state.receipts['sheet:test:both:0:ch2'].chamberId, 2);
  assert.equal(state.cursor['sheet:test:both:1'].lastRowIndex, 0);
  assert.equal(state.cursor['sheet:test:both:2'].lastRowIndex, 0);
});

test('duplicate row advances cursor and records DUPLICATE', async () => {
  const { state, counts } = await run(CSV, {
    ingest: async () => ({ duplicate: true, session: { experimentId: 'exp-1' } }),
  });
  assert.equal(counts.duplicates, 1);
  assert.equal(state.cursor['sheet:test:0:1'].lastRowIndex, 0);
  assert.equal(state.receipts['sheet:test:0:0:ch1'].status, 'DUPLICATE');
});

test('invalid TVOC sentinel is quarantined, not ingested, and cursor advances', async () => {
  const sentinel = [HEADER, '10/22/2026 21:34:43,27.5,79,99999'].join('\n');
  const { state, counts } = await run(sentinel, {
    ingest: async () => {
      throw new Error('must not ingest sentinel');
    },
  });
  assert.equal(counts.rejected, 1);
  assert.equal(state.ingested, 0);
  assert.equal(state.cursor['sheet:test:0:1'].lastRowIndex, 0);
  const receipt = state.receipts['sheet:test:0:0:ch1'];
  assert.equal(receipt.status, 'QUARANTINED_INVALID');
  assert.equal(receipt.reason, 'INVALID_TVOC_SENTINEL');
  assert.equal(receipt.rawRow[3], '99999');
});

test('no active experiment quarantines UNASSIGNED and advances cursor', async () => {
  const { state, counts } = await run(CSV, {
    ingest: async () => {
      const err = new Error('Tidak ada eksperimen aktif');
      err.status = 409;
      err.details = { code: 'NO_ACTIVE_EXPERIMENT' };
      throw err;
    },
  });
  assert.equal(counts.unassigned, 1);
  assert.equal(state.cursor['sheet:test:0:1'].lastRowIndex, 0);
  assert.equal(state.receipts['sheet:test:0:0:ch1'].status, 'UNASSIGNED');
});

test('invalid sample_id is quarantined without calling ingest', async () => {
  const bad = ['timestamp,sample_id,temp1,humid1,tvoc1', '10/22/2026 21:34:43,bad id,27.5,79,88'].join('\n');
  const { state, counts } = await run(bad, {
    ingest: async () => {
      throw new Error('must not ingest invalid sample id');
    },
  });
  assert.equal(counts.rejected, 1);
  assert.equal(state.ingested, 0);
  assert.equal(state.receipts['sheet:test:0:0:ch1'].status, 'QUARANTINED_INVALID');
  assert.equal(state.receipts['sheet:test:0:0:ch1'].reason, 'INVALID_SAMPLE_ID');
});

test('transient failure is retried and cursor stays put until bounded exhaustion', async () => {
  const state = makeState();
  const models = makeModels(state);
  let calls = 0;
  const ingest = async () => {
    calls += 1;
    throw new Error('temporary database failure');
  };

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const counts = await s.processRows(s.parseCsv(CSV), {
      sourceId: 'test:0',
      mode: 'fallback',
      models,
      ingest,
      alreadyStoredFn: async () => false,
    });
    const receipt = state.receipts['sheet:test:0:0:ch1'];
    if (attempt < 5) {
      assert.equal(receipt.status, 'RETRYABLE_ERROR');
      assert.equal(receipt.attempts, attempt);
      assert.ok(!state.cursor['sheet:test:0:1'] || state.cursor['sheet:test:0:1'].lastRowIndex == null);
      assert.equal(counts.retryExhausted, 0);
    } else {
      assert.equal(receipt.status, 'QUARANTINED_RETRY_EXHAUSTED');
      assert.equal(receipt.attempts, 5);
      assert.equal(state.cursor['sheet:test:0:1'].lastRowIndex, 0);
      assert.equal(counts.retryExhausted, 1);
    }
  }
  assert.equal(calls, 5);
});

test('restart skips a terminal receipt without re-ingesting', async () => {
  const state = makeState();
  const models = makeModels(state);
  let calls = 0;
  const ingest = async () => {
    calls += 1;
    return { duplicate: false, session: { experimentId: 'exp-1' } };
  };

  await s.processRows(s.parseCsv(CSV), { sourceId: 'test:0', models, ingest, alreadyStoredFn: async () => false });
  state.cursor = {};
  const counts = await s.processRows(s.parseCsv(CSV), { sourceId: 'test:0', models, ingest, alreadyStoredFn: async () => false });

  assert.equal(calls, 1);
  assert.equal(counts.imported, 0);
  assert.equal(state.cursor['sheet:test:0:1'].lastRowIndex, 0);
});

test('legacy rows keep importer identity separate from firmware identity', async () => {
  const { state } = await run();
  const receipt = state.receipts['sheet:test:0:0:ch1'];
  assert.equal(receipt.eventId, null);
  assert.equal(receipt.sampleId, null);
  assert.match(receipt.rowFingerprint, /^[a-f0-9]{64}$/);
});

test('deferred fallback grace does not advance cursor', async () => {
  const { state, counts } = await run(CSV, { cutoff: new Date(0) });
  assert.equal(counts.deferred, 1);
  assert.ok(!state.cursor['sheet:test:0:1'] || state.cursor['sheet:test:0:1'].lastRowIndex == null);
  assert.equal(state.receipts['sheet:test:0:0:ch1'], undefined);
});

test('legacy row is treated as a duplicate when a close reading already exists', async () => {
  const state = makeState();
  const models = makeModels(state);
  let calls = 0;
  const counts = await s.processRows(s.parseCsv(CSV), {
    sourceId: 'test:legacy-guard',
    mode: 'primary',
    models,
    ingest: async () => {
      calls += 1;
      return { duplicate: false, session: { experimentId: 'exp-1' } };
    },
    alreadyStoredFn: async () => true,
  });
  assert.equal(counts.duplicates, 1);
  assert.equal(calls, 0);
  assert.equal(state.receipts['sheet:test:legacy-guard:0:ch1'].status, 'DUPLICATE');
  assert.equal(state.receipts['sheet:test:legacy-guard:0:ch1'].reason, 'LEGACY_TIME_MATCH');
});

test('concurrent importer processes cannot both claim the same chamber cursor', async () => {
  const state = makeState();
  const models = makeModels(state);
  let calls = 0;
  const ingest = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 50));
    return { duplicate: false, session: { experimentId: 'exp-1' } };
  };

  const [first, second] = await Promise.all([
    s.processRows(s.parseCsv(CSV), { sourceId: 'test:concurrent', models, ingest, alreadyStoredFn: async () => false }),
    s.processRows(s.parseCsv(CSV), { sourceId: 'test:concurrent', models, ingest, alreadyStoredFn: async () => false }),
  ]);

  assert.equal(calls, 1);
  assert.equal(first.locked + second.locked, 1);
  assert.equal(first.imported + second.imported, 1);
  assert.equal(state.cursor['sheet:test:concurrent:1'].lastRowIndex, 0);
  assert.equal(state.cursor['sheet:test:concurrent:1'].leaseUntil, null);
});

test('SHEET_MODE defaults to fallback in a clean environment', () => {
  const out = execFileSync(
    process.execPath,
    ['-e', 'delete process.env.SHEET_MODE; console.log(require("./src/config/env").sheet.mode)'],
    { cwd: `${__dirname}/..` }
  )
    .toString()
    .trim();
  assert.equal(out, 'fallback');
});

test('source identity and row fingerprint helpers are deterministic', () => {
  assert.equal(
    s.sourceIdFromUrl('https://docs.google.com/spreadsheets/d/ABC_123/edit#gid=456'),
    'ABC_123:456'
  );
  assert.equal(
    s.sourceIdFromUrl('https://docs.google.com/spreadsheets/d/e/2PACX-aaa/pub?gid=0&single=true&output=csv'),
    'e:2PACX-aaa:0'
  );
  assert.notEqual(
    s.sourceIdFromUrl('https://docs.google.com/spreadsheets/d/e/2PACX-aaa/pub?gid=1&output=csv'),
    s.sourceIdFromUrl('https://docs.google.com/spreadsheets/d/e/2PACX-bbb/pub?gid=1&output=csv')
  );
  assert.equal(s.rowKey('ABC_123:456', 7, 1), 'sheet:ABC_123:456:7:ch1');
  const head = ['timestamp', 'temp1'];
  const row = ['2026-01-01', '27'];
  assert.equal(s.rowFingerprint(head, row, 1), s.rowFingerprint(head, row, 1));
  assert.notEqual(s.rowFingerprint(head, row, 1), s.rowFingerprint(head, ['2026-01-01', '28'], 1));
});

test('sentinel and error classification are explicit', () => {
  assert.equal(s.isInvalidSheetTvoc(99999), true);
  assert.equal(s.isInvalidSheetTvoc(99998), false);
  assert.equal(s.isInvalidSheetTvoc(100000), false);
  assert.equal(s.isTerminalReceipt('IMPORTED'), true);
  assert.equal(s.isTerminalReceipt('RETRYABLE_ERROR'), false);
  assert.equal(s.classifyImportError({ status: 409, details: { code: 'NO_ACTIVE_EXPERIMENT' } }).status, 'UNASSIGNED');
  assert.equal(s.classifyImportError({ status: 409, details: { code: 'MISSING_EXPERIMENT_SESSION' } }).status, 'QUARANTINED_INTEGRITY');
  assert.equal(s.classifyImportError({ status: 400 }).status, 'QUARANTINED_INVALID');
  assert.equal(s.classifyImportError(new Error('db down')).status, 'RETRYABLE_ERROR');
});

test('legacy source resumes at row 2586 via an explicit source-scoped cursor migration', async () => {
  const state = makeState();
  const models = makeModels(state);
  state.cursor['sheet:1'] = {
    key: 'sheet:1',
    lastRowIndex: 2586,
    lastTimestamp: new Date('2026-11-04T18:04:50Z'),
  };
  const rows = ['timestamp,temp1,humid1,tvoc1'];
  for (let i = 0; i < 2588; i += 1) {
    rows.push(`10/22/2026 21:34:43,27.5,79,${88 + (i % 2)}`);
  }
  let calls = 0;
  const counts = await s.processRows(s.parseCsv(rows.join('\n')), {
    sourceId: 'e:2PACX-test:359910033',
    legacySourceId: 'e:2PACX-test:359910033',
    mode: 'fallback',
    models,
    ingest: async () => {
      calls += 1;
      return { duplicate: false, session: { experimentId: 'exp-1' } };
    },
    alreadyStoredFn: async () => false,
  });
  assert.equal(calls, 1);
  assert.equal(counts.imported, 1);
  assert.equal(state.cursor['sheet:e:2PACX-test:359910033:1'].lastRowIndex, 2587);
  assert.equal(state.cursor['sheet:e:2PACX-test:359910033:1'].migratedFrom, 'sheet:1');
  assert.equal(state.cursor['sheet:1'].lastRowIndex, 2586);
});

test('new source starts with its own cursor and does not reuse the legacy cursor', async () => {
  const state = makeState();
  const models = makeModels(state);
  state.cursor['sheet:1'] = { key: 'sheet:1', lastRowIndex: 2586 };
  state.cursor['sheet:2'] = { key: 'sheet:2', lastRowIndex: 2586 };
  const csv = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '2026-11-05T13:00:00Z,tofusense-20261105T130000000Z-11111111-1111-4111-8111-111111111111,2026-11-05T13:00:00Z,28.1,77,100',
    '2026-11-05T13:05:00Z,tofusense-20261105T130500000Z-22222222-2222-4222-8222-222222222222,2026-11-05T13:05:00Z,28.2,77,101',
  ].join('\n');
  const counts = await s.processRows(s.parseCsv(csv), {
    sourceId: '1X-Bh7UX4f1-jNK76X96lixMFh-WrRmQS8dUs5SWMvNA:572072723',
    legacySourceId: 'e:2PACX-test:359910033',
    mode: 'primary',
    models,
    ingest: async () => ({ duplicate: false, session: { experimentId: 'exp-1' } }),
    alreadyStoredFn: async () => false,
  });
  assert.equal(counts.imported, 2);
  assert.equal(state.cursor['sheet:1X-Bh7UX4f1-jNK76X96lixMFh-WrRmQS8dUs5SWMvNA:572072723:1'].lastRowIndex, 1);
  assert.equal(state.cursor['sheet:1'].lastRowIndex, 2586);
  assert.equal(state.cursor['sheet:2'].lastRowIndex, 2586);
});

test('switching sources does not modify the other source cursor', async () => {
  const state = makeState();
  const models = makeModels(state);
  state.cursor['sheet:1'] = { key: 'sheet:1', lastRowIndex: 1 };
  const oldCsv = [
    'timestamp,temp1,humid1,tvoc1',
    '10/22/2026 21:34:43,27.5,79,88',
    '10/22/2026 21:39:43,27.5,79,89',
    '10/22/2026 21:44:43,27.5,79,90',
  ].join('\n');
  const newCsv = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '2026-11-05T13:00:00Z,tofusense-20261105T130000000Z-11111111-1111-4111-8111-111111111111,2026-11-05T13:00:00Z,28.1,77,100',
    '2026-11-05T13:05:00Z,tofusense-20261105T130500000Z-22222222-2222-4222-8222-222222222222,2026-11-05T13:05:00Z,28.2,77,101',
  ].join('\n');
  const ingest = async () => ({ duplicate: false, session: { experimentId: 'exp-1' } });
  await s.processRows(s.parseCsv(oldCsv), {
    sourceId: 'e:2PACX-test:359910033', legacySourceId: 'e:2PACX-test:359910033', mode: 'primary',
    models, ingest, alreadyStoredFn: async () => false,
  });
  await s.processRows(s.parseCsv(newCsv), {
    sourceId: '1X-Bh7UX4f1-jNK76X96lixMFh-WrRmQS8dUs5SWMvNA:572072723',
    legacySourceId: 'e:2PACX-test:359910033', mode: 'primary',
    models, ingest, alreadyStoredFn: async () => false,
  });
  const newKey = 'sheet:1X-Bh7UX4f1-jNK76X96lixMFh-WrRmQS8dUs5SWMvNA:572072723:1';
  assert.equal(state.cursor[newKey].lastRowIndex, 1);
  assert.equal(state.cursor['sheet:e:2PACX-test:359910033:1'].lastRowIndex, 2);
  assert.equal(state.cursor['sheet:1'].lastRowIndex, 1);
});

test('same sample ids from different sources retain source-scoped receipts', async () => {
  const state = makeState();
  const models = makeModels(state);
  const csv = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '2026-11-05T13:00:00Z,tofusense-20261105T130000000Z-11111111-1111-4111-8111-111111111111,2026-11-05T13:00:00Z,28.1,77,100',
  ].join('\n');
  let calls = 0;
  const ingest = async () => {
    calls += 1;
    return { duplicate: calls > 1, session: { experimentId: 'exp-1' } };
  };
  const first = await s.processRows(s.parseCsv(csv), {
    sourceId: 'source:a', mode: 'primary', models, ingest, alreadyStoredFn: async () => false,
  });
  const second = await s.processRows(s.parseCsv(csv), {
    sourceId: 'source:b', mode: 'primary', models, ingest, alreadyStoredFn: async () => false,
  });
  assert.equal(first.imported, 1);
  assert.equal(second.duplicates, 1);
  assert.equal(state.receipts['sheet:source:a:0:ch1'].status, 'IMPORTED');
  assert.equal(state.receipts['sheet:source:b:0:ch1'].status, 'DUPLICATE');
  assert.equal(calls, 2);
});

test('unmapped legacy cursors stop import instead of silently reprocessing', async () => {
  const state = makeState();
  const models = makeModels(state);
  state.cursor['sheet:1'] = { key: 'sheet:1', lastRowIndex: 2586 };
  let calls = 0;
  const counts = await s.processRows(s.parseCsv(CSV), {
    sourceId: 'source:new',
    legacySourceId: '',
    mode: 'primary',
    models,
    ingest: async () => { calls += 1; return { duplicate: false }; },
    alreadyStoredFn: async () => false,
  });
  assert.equal(calls, 0);
  assert.equal(counts.cursorErrors, 1);
  assert.equal(counts.cursorErrorCode, 'LEGACY_CURSOR_UNMAPPED');
  assert.equal(state.cursor['sheet:1'].lastRowIndex, 2586);
  assert.equal(state.cursor['sheet:source:new:1'], undefined);
});

test('timestamp policy: valid ISO sampled_at wins over received_at', () => {
  const csv = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '11/5/2026,tofusense-20261105T124046690Z-11111111-1111-4111-8111-111111111111,2026-11-05T12:40:46.690Z,28.1,77,100',
  ].join('\n');
  const [r] = s.rowsToReadings(s.parseCsv(csv));
  assert.equal(r.timestampQuality, 'OK');
  assert.equal(r.timestampSource, 'sampled');
  assert.equal(r.timestamp.toISOString(), '2026-11-05T12:40:46.690Z');
});

test('timestamp policy: exact sample_id timestamp is used when sampled_at is empty', () => {
  const csv = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '11/5/2026,tofusense-20261105T124046690Z-11111111-1111-4111-8111-111111111111,,28.1,77,100',
  ].join('\n');
  const [r] = s.rowsToReadings(s.parseCsv(csv));
  assert.equal(r.timestampQuality, 'SAMPLE_ID');
  assert.equal(r.timestampSource, 'sample_id');
  assert.equal(r.timestamp.toISOString(), '2026-11-05T12:40:46.690Z');
});

test('timestamp policy: calendar-invalid sampled_at is rejected', () => {
  const csv = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '11/5/2026,ambiguous-sample-id,2026-02-31T12:00:00Z,28.1,77,100',
  ].join('\n');
  const [r] = s.rowsToReadings(s.parseCsv(csv));
  assert.equal(r.timestamp, null);
  assert.equal(r.timestampQuality, 'INVALID');
});

test('timestamp policy: timezone offset is normalized explicitly', () => {
  const csv = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '11/5/2026,tofusense-20261105T124046690Z-11111111-1111-4111-8111-111111111111,2026-11-05T19:40:46.690+07:00,28.1,77,100',
  ].join('\n');
  const [r] = s.rowsToReadings(s.parseCsv(csv));
  assert.equal(r.timestamp.toISOString(), '2026-11-05T12:40:46.690Z');
});

test('timestamp policy: invalid sampled_at falls back to a validated sample_id timestamp', () => {
  const csv = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '11/5/2026,tofusense-20261105T124046690Z-11111111-1111-4111-8111-111111111111,11/5/2026,28.1,77,100',
  ].join('\n');
  const [r] = s.rowsToReadings(s.parseCsv(csv));
  assert.equal(r.timestampQuality, 'SAMPLE_ID');
  assert.equal(r.timestampSource, 'sample_id');
  assert.equal(r.timestamp.toISOString(), '2026-11-05T12:40:46.690Z');
  assert.equal(r.rawSampledAt, '11/5/2026');
});

test('timestamp policy: invalid sampled_at with an ambiguous sample_id is quarantined', async () => {
  const state = makeState();
  const models = makeModels(state);
  const csv = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '11/5/2026,ambiguous-sample-id,11/5/2026,28.1,77,100',
  ].join('\n');
  const counts = await s.processRows(s.parseCsv(csv), {
    sourceId: 'timestamp:invalid', mode: 'primary', models,
    ingest: async () => { throw new Error('must not ingest'); },
    alreadyStoredFn: async () => false,
  });
  assert.equal(counts.rejected, 1);
  assert.equal(state.receipts['sheet:timestamp:invalid:0:ch1'].reason, 'TIMESTAMP_INVALID');
});

test('timestamp policy: empty sampled_at with ambiguous sample_id is TIMESTAMP_MISSING', async () => {
  const state = makeState();
  const models = makeModels(state);
  const csv = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '11/5/2026,ambiguous-sample-id,,28.1,77,100',
  ].join('\n');
  const counts = await s.processRows(s.parseCsv(csv), {
    sourceId: 'timestamp:missing', mode: 'primary', models,
    ingest: async () => { throw new Error('must not ingest'); },
    alreadyStoredFn: async () => false,
  });
  assert.equal(counts.rejected, 1);
  assert.equal(state.receipts['sheet:timestamp:missing:0:ch1'].reason, 'TIMESTAMP_MISSING');
});

test('timestamp policy: date-only received_at never becomes measurement time', () => {
  const csv = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '11/5/2026,ambiguous-sample-id,,28.1,77,100',
  ].join('\n');
  const [r] = s.rowsToReadings(s.parseCsv(csv));
  assert.equal(r.timestamp, null);
  assert.equal(r.timestampQuality, 'MISSING');
  // received_at is provenance only; it is never promoted to measurement time.
  assert.ok(r.receivedAt instanceof Date);
  assert.equal(r.rawReceivedAt, '11/5/2026');
});

test('timestamp policy: full received_at is preserved as provenance', () => {
  const csv = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '2026-11-05T13:00:00Z,tofusense-20261105T124046690Z-11111111-1111-4111-8111-111111111111,,28.1,77,100',
  ].join('\n');
  const [r] = s.rowsToReadings(s.parseCsv(csv));
  assert.equal(r.receivedAt.toISOString(), '2026-11-05T13:00:00.000Z');
  assert.equal(r.timestampSource, 'sample_id');
});

test('timestamp provenance is passed to ingestion for sample_id fallback', async () => {
  const state = makeState();
  const models = makeModels(state);
  let options = null;
  const csv = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '11/5/2026,tofusense-20261105T124046690Z-11111111-1111-4111-8111-111111111111,,28.1,77,100',
  ].join('\n');
  await s.processRows(s.parseCsv(csv), {
    sourceId: 'timestamp:provenance', mode: 'primary', models,
    ingest: async (_payload, opts) => {
      options = opts;
      return { duplicate: false, session: { experimentId: 'exp-1' } };
    },
    alreadyStoredFn: async () => false,
  });
  assert.equal(options.timestampSource, 'sample_id');
  assert.equal(options.timestampQuality, 'SAMPLE_ID');
});

test('sample_id timestamp is passed as measurement time and date-only received_at is not the receipt clock', async () => {
  const state = makeState();
  const models = makeModels(state);
  let payload = null;
  let options = null;
  const csv = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '11/5/2026,tofusense-20261105T124046690Z-11111111-1111-4111-8111-111111111111,,28.1,77,100',
  ].join('\n');
  const before = Date.now();
  await s.processRows(s.parseCsv(csv), {
    sourceId: 'timestamp:passthrough', mode: 'primary', models,
    ingest: async (p, o) => {
      payload = p;
      options = o;
      return { duplicate: false, session: { experimentId: 'exp-1' } };
    },
    alreadyStoredFn: async () => false,
  });
  assert.equal(payload.sampled_at, '2026-11-05T12:40:46.690Z');
  assert.equal(options.timestampSource, 'sample_id');
  assert.equal(options.timestampQuality, 'SAMPLE_ID');
  assert.ok(options.receivedAt.getTime() >= before - 1000);
  assert.ok(options.receivedAt.getTime() <= Date.now() + 1000);
});

test('valid sampled_at is passed unchanged as measurement time', async () => {
  const state = makeState();
  const models = makeModels(state);
  let payload = null;
  let options = null;
  const csv = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '2026-11-05T13:00:00Z,tofusense-20261105T124046690Z-11111111-1111-4111-8111-111111111111,2026-11-05T12:40:46.690Z,28.1,77,100',
  ].join('\n');
  await s.processRows(s.parseCsv(csv), {
    sourceId: 'timestamp:sampled-passthrough', mode: 'primary', models,
    ingest: async (p, o) => {
      payload = p;
      options = o;
      return { duplicate: false, session: { experimentId: 'exp-1' } };
    },
    alreadyStoredFn: async () => false,
  });
  assert.equal(payload.sampled_at, '2026-11-05T12:40:46.690Z');
  assert.equal(options.timestampSource, 'sampled');
  assert.equal(options.timestampQuality, 'OK');
  assert.equal(options.receivedAt.toISOString(), '2026-11-05T13:00:00.000Z');
});

test('ingest preserves a validated sample_id provenance without changing the stored time', async () => {
  const store = createMemoryStore();
  const sampledAt = '2026-11-04T23:55:00.000Z';
  const receivedAt = new Date('2026-11-05T00:05:00.000Z');
  const result = await ingestReading(
    {
      chamber_id: 1,
      sample_id: 'tofusense-20261105T124046690Z-11111111-1111-4111-8111-111111111111',
      sampled_at: sampledAt,
      tvoc: 100,
      suhu: 28,
      rh: 77,
    },
    { source: 'sheet', receivedAt, timestampSource: 'sample_id', timestampQuality: 'SAMPLE_ID' },
    store
  );
  const reading = result.reading || store.state.readings[0];
  assert.equal(reading.timestamp.toISOString(), sampledAt);
  assert.equal(reading.sampledAt.toISOString(), sampledAt);
  assert.equal(reading.timestampSource, 'sample_id');
  assert.equal(reading.timestampQuality, 'SAMPLE_ID');
});

test('ingest does not relabel a rejected future sample time as SAMPLE_ID', async () => {
  const store = createMemoryStore();
  const receivedAt = new Date('2026-11-05T00:05:00.000Z');
  const future = '2026-11-05T02:00:00.000Z';
  const result = await ingestReading(
    {
      chamber_id: 1,
      sample_id: 'tofusense-20261105T020000000Z-11111111-1111-4111-8111-111111111111',
      sampled_at: future,
      tvoc: 100,
      suhu: 28,
      rh: 77,
    },
    { source: 'sheet', receivedAt, timestampSource: 'sample_id', timestampQuality: 'SAMPLE_ID' },
    store
  );
  const reading = result.reading || store.state.readings[0];
  assert.equal(reading.sampledAt, null);
  assert.equal(reading.timestamp.toISOString(), receivedAt.toISOString());
  assert.equal(reading.timestampSource, 'received_at');
  assert.equal(reading.timestampQuality, 'INVALID');
});

test('a terminal receipt is not overwritten by a later timestamp quarantine', async () => {
  const state = makeState();
  const models = makeModels(state);
  const sourceId = 'terminal:keep';
  const good = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '2026-11-05T13:00:00Z,tofusense-20261105T124046690Z-11111111-1111-4111-8111-111111111111,2026-11-05T12:40:46.690Z,28.1,77,100',
  ].join('\n');
  await s.processRows(s.parseCsv(good), {
    sourceId, mode: 'primary', models,
    ingest: async () => ({ duplicate: false, session: { experimentId: 'exp-1' } }),
    alreadyStoredFn: async () => false,
  });
  assert.equal(state.receipts['sheet:terminal:keep:0:ch1'].status, 'IMPORTED');

  // Simulate an operator rewind after the Sheet timestamp became unusable.
  state.cursor['sheet:terminal:keep:1'].lastRowIndex = null;
  const bad = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '11/5/2026,ambiguous-sample-id,,28.1,77,100',
  ].join('\n');
  const counts = await s.processRows(s.parseCsv(bad), {
    sourceId, mode: 'primary', models,
    ingest: async () => { throw new Error('must not ingest'); },
    alreadyStoredFn: async () => false,
  });
  assert.equal(counts.rejected, 0);
  assert.equal(state.receipts['sheet:terminal:keep:0:ch1'].status, 'IMPORTED');
});

test('returning to the legacy source does not replay historical rows', async () => {
  const state = makeState();
  const models = makeModels(state);
  const legacySource = 'e:2PACX-test:359910033';
  const targetSource = '1X-Bh7UX4f1-jNK76X96lixMFh-WrRmQS8dUs5SWMvNA:572072723';
  const legacyCsv = [
    'timestamp,temp1,humid1,tvoc1',
    '10/22/2026 21:34:43,27.5,79,88',
    '10/22/2026 21:39:43,27.5,79,89',
    '10/22/2026 21:44:43,27.5,79,90',
  ].join('\n');
  const targetCsv = [
    'received_at,sample_id,sampled_at,temp1,humid1,tvoc1',
    '2026-11-05T13:00:00Z,tofusense-20261105T130000000Z-11111111-1111-4111-8111-111111111111,2026-11-05T13:00:00Z,28.1,77,100',
  ].join('\n');
  let calls = 0;
  const ingest = async () => {
    calls += 1;
    return { duplicate: false, session: { experimentId: 'exp-1' } };
  };
  await s.processRows(s.parseCsv(legacyCsv), {
    sourceId: legacySource, legacySourceId: legacySource, mode: 'primary',
    models, ingest, alreadyStoredFn: async () => false,
  });
  await s.processRows(s.parseCsv(targetCsv), {
    sourceId: targetSource, legacySourceId: legacySource, mode: 'primary',
    models, ingest, alreadyStoredFn: async () => false,
  });
  const callsBeforeReturn = calls;
  const third = await s.processRows(s.parseCsv(legacyCsv), {
    sourceId: legacySource, legacySourceId: legacySource, mode: 'primary',
    models, ingest, alreadyStoredFn: async () => false,
  });
  assert.equal(third.imported, 0);
  assert.equal(calls, callsBeforeReturn);
  assert.equal(state.cursor['sheet:e:2PACX-test:359910033:1'].lastRowIndex, 2);
  assert.equal(state.cursor['sheet:1X-Bh7UX4f1-jNK76X96lixMFh-WrRmQS8dUs5SWMvNA:572072723:1'].lastRowIndex, 0);
});

test('a truncated sheet clamps the row cursor instead of replaying history', async () => {
  const state = makeState();
  const models = makeModels(state);
  state.cursor['sheet:shrink:1'] = { key: 'sheet:shrink:1', lastRowIndex: 5 };
  let calls = 0;
  const truncated = [
    'timestamp,temp1,humid1,tvoc1',
    '10/22/2026 21:34:43,27.5,79,88',
    '10/22/2026 21:39:43,27.5,79,89',
  ].join('\n');
  const counts = await s.processRows(s.parseCsv(truncated), {
    sourceId: 'shrink', mode: 'primary', models,
    ingest: async () => { calls += 1; return { duplicate: false }; },
    alreadyStoredFn: async () => false,
  });
  assert.equal(calls, 0);
  assert.equal(counts.imported, 0);
  assert.equal(state.cursor['sheet:shrink:1'].lastRowIndex, 5);
});
