const mongoose = require('mongoose');

/**
 * Durable RSL notification event. The unique identity is the deduplication
 * boundary: one event per experiment, chamber, threshold kind, and threshold
 * value. A threshold change creates a new identity; ordinary polling does not.
 */
const notificationEventSchema = new mongoose.Schema(
  {
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
    kind: {
      type: String,
      enum: ['rsl_watch', 'rsl_low'],
      required: true,
    },
    thresholdHours: { type: Number, required: true },
    lowerHours: { type: Number, required: true },
    upperHours: { type: Number, required: true },
    level: { type: String, enum: ['warning', 'danger'], required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    disclaimer: { type: String, default: null },
    deliveryStatus: {
      type: String,
      enum: ['in_app', 'sent', 'failed'],
      default: 'in_app',
    },
    sentAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'notificationevents' }
);

notificationEventSchema.index(
  {
    experimentId: 1,
    sessionId: 1,
    chamberId: 1,
    kind: 1,
    thresholdHours: 1,
  },
  { unique: true, name: 'uniq_rsl_notification_event' }
);
notificationEventSchema.index({ experimentId: 1, createdAt: -1 });

module.exports = mongoose.model('NotificationEvent', notificationEventSchema);
