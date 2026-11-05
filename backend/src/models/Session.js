const mongoose = require('mongoose');

/**
 * SESI: satu sesi = satu batch tahu di dalam satu chamber (koleksi "sesis" sesuai proposal Bab 8).
 * - shelfLifeAwal / prediksiDibuat (t0) di-update setiap ada prediksi baru, sehingga
 *   sisa waktu = shelfLifeAwal*3600 - (sekarang - prediksiDibuat).
 * - shelfLifeMulai: prediksi pertama sesi ini (dipakai analisis musiman).
 */
const sessionSchema = new mongoose.Schema(
  {
    seq: { type: Number, required: true, unique: true },
    sesiCode: { type: String, required: true, unique: true }, // CH-001 (ID sesi, berurutan)
    experimentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Experiment',
      default: null,
      index: true,
    },
    chamberId: { type: Number, required: true, index: true },
    status: { type: String, enum: ['aktif', 'selesai'], default: 'aktif' },
    // Operator-provided sample status. UNKNOWN is a real state: it must never be
    // silently converted to NOT_SPOILED and it must not produce a normal RSL.
    sampleStatus: {
      type: String,
      enum: ['UNKNOWN', 'NOT_SPOILED', 'SPOILED'],
      default: 'UNKNOWN',
    },
    sampleStatusUpdatedAt: { type: Date, default: null },
    sampleStatusUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Small audit trail; keeps the latest state above as the fast read path.
    sampleStatusHistory: {
      type: [
        {
          _id: false,
          status: { type: String, enum: ['UNKNOWN', 'NOT_SPOILED', 'SPOILED'] },
          at: { type: Date, required: true },
          by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        },
      ],
      default: [],
    },
    // Frozen RSL reference is DRY-only. UNKNOWN/WATER must return an explicit
    // unavailable result rather than borrowing the dry reference.
    storageCondition: {
      type: String,
      enum: ['DRY', 'WATER', 'UNKNOWN'],
      default: 'DRY',
    },
    // First accepted reading time for chamber audit. Null until the first
    // reading arrives; new experiment sessions are created before any data.
    masuk: { type: Date, default: null },
    selesai: { type: Date, default: null },
    tvoc_awal: { type: Number, default: null },
    suhu_awal: { type: Number, default: null },
    rh_awal: { type: Number, default: null },
    shelfLifeMulai: { type: Number, default: null },
    shelfLifeAwal: { type: Number, default: null }, // prediksi terbaru (jam)
    prediksiDibuat: { type: Date, default: null }, // t0 prediksi terbaru
    modelUsed: { type: String, default: null },
    readingCount: { type: Number, default: 0 },
    statusAkhir: { type: String, default: null }, // status saat sesi ditutup
    sisaAkhirJam: { type: Number, default: null },
    // Penanda notifikasi WhatsApp yang sudah terkirim, agar tiap kejadian hanya dikirim sekali per sesi.
    notified: {
      mulai: { type: Date, default: null }, // "tahu baru masuk" (data & prediksi pertama diterima)
      segeraJual: { type: Date, default: null },
      tidakLayak: { type: Date, default: null },
      offline: { type: Date, default: null },
    },
  },
  { timestamps: true, collection: 'sesis' }
);

// Hanya boleh ada satu sesi aktif per chamber.
sessionSchema.index(
  { chamberId: 1 },
  { unique: true, partialFilterExpression: { status: 'aktif' }, name: 'uniq_active_per_chamber' }
);
// Access pattern for experiment-aware ingestion and API reads.
sessionSchema.index({ experimentId: 1, chamberId: 1, status: 1 });
// One active session per chamber within one experiment. Historical sessions
// (experimentId null) are excluded by the partial filter.
sessionSchema.index(
  { experimentId: 1, chamberId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'aktif', experimentId: { $type: 'objectId' } },
    name: 'uniq_active_experiment_chamber',
  }
);
sessionSchema.index({ masuk: -1 });

sessionSchema.statics.codeFor = (seq) => `CH-${String(seq).padStart(3, '0')}`;

module.exports = mongoose.model('Session', sessionSchema);
