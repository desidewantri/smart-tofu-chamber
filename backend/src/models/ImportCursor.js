const mongoose = require('mongoose');

/** Penanda baris terakhir yang sudah diimpor dari sumber luar (mis. Google Sheet), per chamber. */
const cursorSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true }, // contoh: "sheet:1"
    lastTimestamp: { type: Date, default: null },
  // Posisi baris data terakhir yang sudah diproses (0-based). Monoton walau
  // sampled_at datang tidak urut; dipakai sebagai cursor utama.
  lastRowIndex: { type: Number, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ImportCursor', cursorSchema);
