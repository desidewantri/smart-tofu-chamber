const mongoose = require('mongoose');

const chamberSchema = new mongoose.Schema(
  {
    chamberId: { type: Number, required: true, unique: true }, // 1, 2, 3 ... (dipakai di topik MQTT)
    code: { type: String, required: true, unique: true }, // CH-001
    name: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

chamberSchema.statics.codeFor = (chamberId) => `CH-${String(chamberId).padStart(3, '0')}`;

module.exports = mongoose.model('Chamber', chamberSchema);
