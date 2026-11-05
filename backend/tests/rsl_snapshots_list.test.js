const test = require('node:test');
const assert = require('node:assert/strict');

const recovery = require('../src/services/rslSnapshotService');
const { rslSnapshotView } = require('../src/utils/presenters');
const { createMemoryStore } = require('./helpers/memoryStore');

function snapshot({ chamberId, snapshotAt, lower = 3, upper = 12, status = 'AVAILABLE' }) {
  return {
    _id: `snap-${chamberId}-${snapshotAt}`,
    experimentId: `exp-${chamberId}-${snapshotAt}`,
    sessionId: `ses-${chamberId}-${snapshotAt}`,
    chamberId,
    experimentLabel: `Experiment ${snapshotAt}`,
    sesiCode: `CH-00${chamberId}`,
    snapshotAt: new Date(snapshotAt),
    endedAt: new Date(snapshotAt),
    elapsedHours: 20,
    status,
    reason: status === 'AVAILABLE' ? null : 'RSL_UNAVAILABLE',
    primary:
      status === 'AVAILABLE'
        ? {
            method: 'M1',
            lowerHours: lower,
            upperHours: upper,
            display: { lowerHours: Math.floor(lower), upperHours: Math.ceil(upper) },
          }
        : null,
    supporting: { M2: { status: 'OK' }, M3: { available: true } },
    metadata: {
      referenceVersion: 'v2.3-frozen-2026-11-04',
      referencePopulation: 3,
      referenceStorageCondition: 'DRY',
    },
  };
}

test('listForChamber returns only the requested chamber, newest first, with a limit', async () => {
  const store = createMemoryStore();
  store.state.rslSnapshots.push(
    snapshot({ chamberId: 1, snapshotAt: '2026-11-01T00:00:00.000Z' }),
    snapshot({ chamberId: 1, snapshotAt: '2026-11-03T00:00:00.000Z' }),
    snapshot({ chamberId: 1, snapshotAt: '2026-11-02T00:00:00.000Z' }),
    snapshot({ chamberId: 2, snapshotAt: '2026-11-04T00:00:00.000Z' })
  );

  const items = await recovery.listForChamber({
    chamberId: 1,
    limit: 2,
    models: store.models,
  });

  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((item) => item.snapshotAt.toISOString()),
    ['2026-11-03T00:00:00.000Z', '2026-11-02T00:00:00.000Z']
  );
  assert.ok(items.every((item) => item.chamberId === 1));
  assert.equal(items[0].primary.lowerHours, 3);
  assert.equal(items[0].metadata.referenceVersion, 'v2.3-frozen-2026-11-04');
});

test('listForChamber returns an empty array when no snapshot exists', async () => {
  const store = createMemoryStore();
  const items = await recovery.listForChamber({
    chamberId: 2,
    models: store.models,
  });
  assert.deepEqual(items, []);
});

test('rslSnapshotView preserves snapshot provenance and never marks it live', () => {
  const view = rslSnapshotView(
    snapshot({ chamberId: 2, snapshotAt: '2026-11-04T00:00:00.000Z' })
  );
  assert.equal(view.isSnapshot, true);
  assert.equal(view.chamberId, 2);
  assert.equal(view.snapshotAt.toISOString(), '2026-11-04T00:00:00.000Z');
  assert.equal(view.status, 'AVAILABLE');
  assert.equal(view.primary.lowerHours, 3);
  assert.equal(view.supporting.M2.status, 'OK');
  assert.equal(view.metadata.referenceVersion, 'v2.3-frozen-2026-11-04');
  assert.equal(view.metadata.referenceStorageCondition, 'DRY');
});
