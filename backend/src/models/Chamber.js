const mongoose = require('mongoose');

const chamberSchema = new mongoose.Schema(
  {
    chamberId: { type: Number, required: true, unique: true }, // 1 atau 2 (dipakai di topik MQTT)
    code: { type: String, required: true, unique: true }, // kode internal; yang tampil hanya nama (Chamber 1 / Chamber 2)
    name: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

chamberSchema.statics.codeFor = (chamberId) => `CHAMBER-${chamberId}`;

module.exports = mongoose.model('Chamber', chamberSchema);
