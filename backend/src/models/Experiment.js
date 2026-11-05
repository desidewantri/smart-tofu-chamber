const mongoose = require('mongoose');

/**
 * One experiment groups the two chamber sessions that belong to the same tofu
 * batch. `startedAt` is the canonical startpoint for elapsed-time/RSL features;
 * `Session.masuk` remains the first accepted reading time for chamber audit.
 */
const experimentSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, default: null, maxlength: 120 },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    status: { type: String, enum: ['aktif', 'selesai'], default: 'aktif' },
    chamberIds: { type: [Number], default: [1, 2] },
    // The frozen RSL reference is DRY-only. WATER is accepted by the lifecycle
    // API but the RSL endpoint must return UNSUPPORTED_CONDITION, never a
    // dry-reference estimate.
    storageCondition: {
      type: String,
      enum: ['DRY', 'WATER', 'UNKNOWN'],
      default: 'DRY',
    },
    // Persistence completeness for the two final RSL snapshots. This is not the
    // statistical RSL status: an UNAVAILABLE snapshot still counts as persisted.
    rslSnapshotStatus: {
      type: String,
      enum: ['PENDING', 'COMPLETE'],
      default: null,
    },
    rslSnapshotExpectedCount: { type: Number, default: 2 },
    rslSnapshotCompletedCount: { type: Number, default: 0 },
    rslSnapshotLastAttemptAt: { type: Date, default: null },
    rslSnapshotLastErrorCode: { type: String, default: null, maxlength: 120 },
    rslSnapshotRecoveredAt: { type: Date, default: null },
    rslSnapshotAttempts: { type: Number, default: 0 },
    rslSnapshotNextAttemptAt: { type: Date, default: null },
    rslSnapshotLeaseUntil: { type: Date, default: null },
    rslSnapshotLeaseOwner: { type: String, default: null, maxlength: 160 },
    // Experiment finalization is separate from snapshot persistence. A stopped
    // experiment can have both snapshots but still be PENDING because a chamber
    // session remains active.
    finalizationStatus: {
      type: String,
      enum: ['PENDING', 'COMPLETE'],
      default: null,
    },
    finalizationExpectedSessionCount: { type: Number, default: 2 },
    finalizationClosedSessionCount: { type: Number, default: 0 },
    finalizationLastAttemptAt: { type: Date, default: null },
    finalizationLastErrorCode: { type: String, default: null, maxlength: 120 },
    finalizationRecoveredAt: { type: Date, default: null },
    finalizationAttempts: { type: Number, default: 0 },
    finalizationNextAttemptAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'experiments' }
);

// Only one experiment may be active at a time.
experimentSchema.index(
  { status: 1 },
  { unique: true, partialFilterExpression: { status: 'aktif' }, name: 'uniq_active_experiment' }
);
experimentSchema.index({ startedAt: -1 });
// Recovery queue: closed experiments awaiting snapshot reconciliation.
experimentSchema.index(
  { status: 1, rslSnapshotStatus: 1, rslSnapshotNextAttemptAt: 1 },
  { name: 'rsl_snapshot_recovery_queue' }
);
experimentSchema.index(
  { status: 1, finalizationStatus: 1, finalizationNextAttemptAt: 1 },
  { name: 'experiment_finalization_queue' }
);

module.exports = mongoose.model('Experiment', experimentSchema);
