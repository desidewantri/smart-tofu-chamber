const ApiError = require('../utils/ApiError');

function notFound(req, _res, next) {
  next(new ApiError(404, `Endpoint tidak ditemukan: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  let status = err.status || 500;
  let message = err.message || 'Terjadi kesalahan pada server';

  if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors || {}).map((e) => e.message).join('; ') || message;
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Nilai tidak valid untuk ${err.path}`;
  } else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    status = 401;
    message = 'Sesi login tidak valid atau sudah kedaluwarsa';
  } else if (err.code === 11000) {
    status = 409;
    message = 'Data sudah ada (duplikat)';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Body JSON tidak valid';
  }

  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ success: false, message, ...(err.details ? { details: err.details } : {}) });
}

module.exports = { notFound, errorHandler };
