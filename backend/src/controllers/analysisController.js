const asyncHandler = require('../utils/asyncHandler');
const { parseChamberId } = require('../utils/params');
const ApiError = require('../utils/ApiError');
const analysis = require('../services/analysisService');

const optionalChamber = (v) => (v && v !== 'all' ? parseChamberId(v) : null);

exports.condition = asyncHandler(async (req, res) => {
  if (!req.query.chamberId) throw new ApiError(400, 'chamberId wajib diisi');
  const data = await analysis.getCondition({
    chamberId: parseChamberId(req.query.chamberId),
    period: req.query.period,
  });
  res.json({ success: true, data });
});

exports.costBenefit = asyncHandler(async (req, res) => {
  const data = await analysis.getCostBenefit({
    chamberId: optionalChamber(req.query.chamberId),
    period: req.query.period,
  });
  res.json({ success: true, data });
});

exports.seasonal = asyncHandler(async (req, res) => {
  const data = await analysis.getSeasonal({
    chamberId: optionalChamber(req.query.chamberId),
    period: req.query.period,
  });
  res.json({ success: true, data });
});
