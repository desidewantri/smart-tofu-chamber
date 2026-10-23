const mongoose = require('mongoose');

const sensorReadingSchema = new mongoose.Schema(
  {
    chamberId: { type: Number, required: true },
    sesiId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', default: null },
    tvoc: { type: Number, required: true }, // ppb
    suhu: { type: Number, required: true }, // °C
    rh: { type: Number, required: true }, // %
    battery: { type: Number, default: null }, // % baterai alat (opsional)
    timestamp: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

sensorReadingSchema.index({ chamberId: 1, timestamp: -1 });
sensorReadingSchema.index({ sesiId: 1, timestamp: 1 });

module.exports = mongoose.model('SensorReading', sensorReadingSchema);
