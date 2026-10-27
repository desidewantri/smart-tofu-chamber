const ApiError = require('./ApiError');

/** Terima "1", 1, atau "CH-001" -> 1 */
function parseChamberId(param) {
  const s = String(param).trim();
  const m = /^CH-0*(\d+)$/i.exec(s);
  const n = m ? Number(m[1]) : Number(s);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, 'ID chamber tidak valid');
  return n;
}

const isObjectId = (s) => /^[0-9a-fA-F]{24}$/.test(String(s));

function parsePaging(query, defaults = { page: 1, limit: 10 }) {
  const page = Math.max(1, parseInt(query.page, 10) || defaults.page);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || defaults.limit));
  return { page, limit };
}

module.exports = { parseChamberId, isObjectId, parsePaging };
