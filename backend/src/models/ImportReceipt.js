const mongoose = require('mongoose');

/**
 * Durable outcome for one source row processed by the Sheet importer.
 *
 * This is separate from SensorReading.eventId: legacy Sheet rows have no
 * firmware identity, but they still need idempotent processing. `key` is the
 * stable source-row identity; `rowFingerprint` catches the same row after it
 * moves to a different row index.
 */
const importReceiptSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    source: { type: String, default: 'sheet' },
    sourceId: { type: String, default: null }, // spreadsheetId:gid
    rowIndex: { type: Number, default: null },
    rowFingerprint: { type: String, default: null, index: true },
    chamberId: { type: Number, default: null },
    eventId: { type: String, default: null },
    sampleId: { type: String, default: null },
    experimentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Experiment', default: null },
    status: {
      type: String,
      required: true,
      enum: [
        'IMPORTED',
        'DUPLICATE',
        'QUARANTINED_INVALID',
        'UNASSIGNED',
        'QUARANTINED_INTEGRITY',
        'QUARANTINED_RETRY_EXHAUSTED',
        'RETRYABLE_ERROR',
      ],
      index: true,
    },
    reason: { type: String, default: null },
    rawRow: { type: [String], default: [] },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
  },
  { timestamps: true, collection: 'importreceipts' }
);

importReceiptSchema.index({ sourceId: 1, rowIndex: 1 });

module.exports = mongoose.model('ImportReceipt', importReceiptSchema);
