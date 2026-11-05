const mongoose = require('mongoose');

/**
 * One logical chamber observation.
 *
 * `eventId` is the cross-source identity (`<sample_id>-ch<n>`). It is the same
 * whether the observation arrived over MQTT or was recovered from the Google
 * Sheets fallback, so the unique index below turns "dual send" into "single
 * ingest". Older rows without an event id are excluded by the partial filter and
 * keep working unchanged.
 */
const sensorReadingSchema = new mongoose.Schema(
  {
    eventId: { type: String, default: null },
    sampleId: { type: String, default: null },
    deviceId: { type: String, default: null },
    chamberId: { type: Number, required: true },
    sesiId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', default: null },
    tvoc: { type: Number, required: true }, // ppb
    suhu: { type: Number, required: true }, // °C
    rh: { type: Number, required: true }, // %
    battery: { type: Number, default: null }, // % baterai alat (opsional)
    // Effective ordering time: sampledAt when the device supplied a usable time,
    // otherwise receivedAt. Kept as `timestamp` for backward compatibility.
    timestamp: { type: Date, required: true },
    sampledAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
    timestampSource: { type: String, enum: ['sampled', 'received_at', null], default: null },
    timestampQuality: { type: String, enum: ['OK', 'MISSING', 'INVALID', null], default: null },
    // Jalur masuk data: mqtt | sheet | http (null = data lama sebelum kolom ini ada)
    source: { type: String, enum: ['mqtt', 'sheet', 'http', null], default: null },
    // Semua jalur yang pernah membawa event ini (mqtt dan/atau sheet).
    sources: { type: [String], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

sensorReadingSchema.index({ chamberId: 1, timestamp: -1 });
sensorReadingSchema.index({ sesiId: 1, timestamp: 1 });
// Idempotency across MQTT and Sheets. Partial: legacy rows without an event id
// must not collide with each other.
sensorReadingSchema.index(
  { eventId: 1 },
  { unique: true, partialFilterExpression: { eventId: { $type: 'string' } } }
);

module.exports = mongoose.model('SensorReading', sensorReadingSchema);
