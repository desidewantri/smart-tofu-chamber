const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new ApiError(401, 'Silakan masuk terlebih dahulu');
  const payload = jwt.verify(token, env.jwtSecret);
  const user = await User.findById(payload.id);
  if (!user) throw new ApiError(401, 'Akun tidak ditemukan');
  req.user = user;
  next();
});

/** Untuk POST /api/sensor dari perangkat/simulator. Dimatikan bila DEVICE_API_KEY kosong. */
function requireDeviceKey(req, _res, next) {
  if (!env.deviceApiKey) return next();
  if (req.headers['x-api-key'] === env.deviceApiKey) return next();
  return next(new ApiError(401, 'Kunci API perangkat tidak valid'));
}

module.exports = { requireAuth, requireDeviceKey };
