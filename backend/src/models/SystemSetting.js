const mongoose = require('mongoose');

const limits = (aman, perhatian) => ({
  aman: { type: Number, default: aman },
  perhatian: { type: Number, default: perhatian },
});

/**
 * Pengaturan sistem (satu dokumen, key = "default"). Dipakai halaman Settings.
 * Nilai batas parameter adalah titik awal yang bisa disesuaikan setelah ada data lab.
 */
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    appName: { type: String, default: 'TOSCHA' },
    appDescription: {
      type: String,
      default: 'Sistem pemantauan dan analitik prediktif untuk memperkirakan umur simpan tahu.',
    },
    updateIntervalMinutes: { type: Number, default: 5, min: 1, max: 60 },
    zones: {
      segarHours: { type: Number, default: 24 }, // > 24 jam  => Layak Konsumsi
      rawanHours: { type: Number, default: 8 }, //  8-24 jam => Segera Konsumsi, < 8 => Tidak Layak Konsumsi
    },
    notifications: {
      enabled: { type: Boolean, default: true },
      onSegeraJual: { type: Boolean, default: true },
      onTidakLayak: { type: Boolean, default: true },
      onOffline: { type: Boolean, default: true },
      onLowBattery: { type: Boolean, default: true },
      whatsapp: {
        enabled: { type: Boolean, default: false },
        recipients: { type: [String], default: [] }, // nomor tujuan, format 62812...
      },
    },
    thresholds: {
      tvoc: limits(200, 400), // ppb
      suhu: limits(25, 30), // °C
      rh: limits(75, 85), // %
    },
    // Penanda internal: kapan peringatan WhatsApp "baterai lemah" terakhir dikirim (null = belum / sudah diisi ulang).
    batteryLowNotifiedAt: { type: Date, default: null },
    business: {
      batchKg: { type: Number, default: 10 }, // berat tahu per sesi
      pricePerKg: { type: Number, default: 15000 }, // Rp
      discountSegera: { type: Number, default: 0.3 }, // diskon saat "Segera Konsumsi"
      lossRateWithoutSystem: { type: Number, default: 0.15 }, // asumsi tahu terbuang tanpa sistem
      operationalCostPerSession: { type: Number, default: 2000 }, // Rp
    },
  },
  { timestamps: true }
);

settingSchema.statics.get = async function () {
  let doc = await this.findOne({ key: 'default' });
  if (!doc) doc = await this.create({ key: 'default' });
  return doc;
};

module.exports = mongoose.model('SystemSetting', settingSchema);
