const mongoose = require('mongoose');

/**
 * Immutable final RSL result for one chamber of a completed experiment.
 *
 * A snapshot is created once, at experiment stop, and is never overwritten by
 * dashboard refreshes or repeated stop calls. The full-precision canonical
 * values are stored alongside the presentation-rounded values.
 */
const rslSnapshotSchema = new mongoose.Schema(
  {
    schemaVersion: { type: Number, default: 1 },
    experimentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Experiment',
      required: true,
      index: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      required: true,
    },
    chamberId: { type: Number, required: true },
    experimentLabel: { type: String, default: null },
    sesiCode: { type: String, default: null },
    storageCondition: {
      type: String,
      enum: ['DRY', 'WATER', 'UNKNOWN'],
      default: 'DRY',
    },
    snapshotAt: { type: Date, required: true },
    endedAt: { type: Date, required: true },
    elapsedHours: { type: Number, default: null },
    sampleStatus: {
      type: String,
      enum: ['UNKNOWN', 'NOT_SPOILED', 'SPOILED'],
      default: 'UNKNOWN',
    },
    sampleStatusUpdatedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['AVAILABLE', 'UNAVAILABLE'],
      required: true,
    },
    reason: { type: String, default: null },
    message: { type: String, default: null },
    primary: { type: mongoose.Schema.Types.Mixed, default: null },
    supporting: { type: mongoose.Schema.Types.Mixed, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    timestampQuality: { type: String, default: null },
    lastReadingAt: { type: Date, default: null },
    readingCount: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'rslsnapshots' }
);

// One canonical final snapshot per experiment/chamber and per session.
rslSnapshotSchema.index(
  { experimentId: 1, chamberId: 1 },
  { unique: true, name: 'uniq_experiment_chamber_rsl_snapshot' }
);
rslSnapshotSchema.index(
  { sessionId: 1 },
  { unique: true, name: 'uniq_session_rsl_snapshot' }
);

module.exports = mongoose.model('RslSnapshot', rslSnapshotSchema);
