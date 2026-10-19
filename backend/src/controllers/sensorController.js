const SensorReading = require('../models/SensorReading');
const asyncHandler = require('../utils/asyncHandler');
const { parseChamberId } = require('../utils/params');
const { readingView, sessionView } = require('../utils/presenters');
const SystemSetting = require('../models/SystemSetting');
const { ingestReading } = require('../services/ingestService');

/** GET /api/sensor/:chamberId?limit=&from=&to= */
exports.listByChamber = asyncHandler(async (req, res) => {
  const chamberId = parseChamberId(req.params.chamberId);
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const filter = { chamberId };
  if (req.query.from || req.query.to) {
    filter.timestamp = {};
    if (req.query.from) filter.timestamp.$gte = new Date(req.query.from);
    if (req.query.to) filter.timestamp.$lte = new Date(req.query.to);
  }
  const items = await SensorReading.find(filter).sort({ timestamp: -1 }).limit(limit).lean();
  res.json({ success: true, data: items.map(readingView) });
});

/** POST /api/sensor  (fallback HTTP selain MQTT; header x-api-key) */
exports.ingest = asyncHandler(async (req, res) => {
  const { reading, session, prediction, predictionError } = await ingestReading(req.body);
  const settings = await SystemSetting.get();
  res.status(201).json({
    success: true,
    message: `Data sensor chamber ${reading.chamberId} disimpan`,
    data: {
      reading: readingView(reading),
      session: sessionView(session, settings.zones),
      prediction: prediction
        ? { shelfLifeJam: prediction.shelfLifeJam, modelUsed: prediction.modelUsed }
        : null,
      predictionError,
    },
  });
});
