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
    chamberId: { type: Number, required: true, index: true },
    status: { type: String, enum: ['aktif', 'selesai'], default: 'aktif' },
    masuk: { type: Date, required: true },
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
sessionSchema.index({ masuk: -1 });

sessionSchema.statics.codeFor = (seq) => `CH-${String(seq).padStart(3, '0')}`;

module.exports = mongoose.model('Session', sessionSchema);
