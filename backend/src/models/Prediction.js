const mongoose = require('mongoose');

const predictionSchema = new mongoose.Schema(
  {
    sesiId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
    chamberId: { type: Number, required: true },
    tvoc_snapshot: { type: Number, required: true },
    suhu_snapshot: { type: Number, required: true },
    rh_snapshot: { type: Number, required: true },
    shelfLifeJam: { type: Number, required: true },
    modelUsed: {
      type: String,
      enum: ['random_forest', 'lstm', 'hybrid', 'mock'],
      default: 'mock',
    },
    prediksiDibuat: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

predictionSchema.index({ sesiId: 1, prediksiDibuat: 1 });
predictionSchema.index({ chamberId: 1, prediksiDibuat: -1 });

module.exports = mongoose.model('Prediction', predictionSchema);
