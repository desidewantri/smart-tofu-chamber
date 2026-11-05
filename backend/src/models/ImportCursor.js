const mongoose = require('mongoose');

/** Penanda baris terakhir yang sudah diimpor dari sumber luar (mis. Google Sheet), per chamber. */
const cursorSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true }, // sheet:<sourceId>:<chamberId>
    sourceId: { type: String, default: null, index: true },
    migratedFrom: { type: String, default: null },
    migratedAt: { type: Date, default: null },
    lastTimestamp: { type: Date, default: null },
    // Posisi baris data terakhir yang sudah diproses (0-based). Monoton walau
    // sampled_at datang tidak urut; dipakai sebagai cursor utama.
    lastRowIndex: { type: Number, default: null },
    // Short-lived lease so two importer processes do not process the same
    // chamber concurrently. Expires automatically after a crash.
    leaseUntil: { type: Date, default: null },
    leaseOwner: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ImportCursor', cursorSchema);
