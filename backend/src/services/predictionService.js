const env = require('../config/env');
const { predictMock } = require('../utils/mlMock');

/** Samakan nama model dari ml-service ke enum di database. */
function normalizeModel(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('lstm')) return 'lstm';
  if (n.includes('random') || n === 'rf') return 'random_forest';
  if (n.includes('mock')) return 'mock';
  return 'hybrid';
}

/**
 * Kontrak dengan ml-service (FastAPI, milik teman):
 *   POST {ML_SERVICE_URL}/predict
 *   body : { chamber_id, session_id, tvoc, suhu, rh, n_t, history: [{tvoc,suhu,rh,timestamp}, ...] }
 *          (field wajib minimal: tvoc, suhu, rh. Sisanya opsional untuk LSTM/state machine.)
 *   resp : { shelf_life_hours: number, model_used: "random_forest" | "lstm" | "hybrid" }
 *          (alias yang diterima: shelfLifeJam/shelf_life, model)
 */
// Fitur tambahan khusus model mock tidak dikirim ke ml-service (kontraknya tetap seperti semula).
const withoutFeatures = ({ features, ...rest }) => rest;

async function callLive(input) {
  const res = await fetch(`${env.ml.url}/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withoutFeatures(input)),
    signal: AbortSignal.timeout(env.ml.timeoutMs),
  });
  if (!res.ok) throw new Error(`ml-service membalas HTTP ${res.status}`);
  const data = await res.json();
  const hours = Number(data.shelf_life_hours ?? data.shelfLifeJam ?? data.shelf_life);
  if (!Number.isFinite(hours) || hours < 0) throw new Error('Respons ml-service tidak valid');
  return {
    shelfLifeJam: Math.round(hours * 100) / 100,
    modelUsed: normalizeModel(data.model_used ?? data.model),
  };
}

async function predict(input, mode = env.ml.mode) {
  if (mode === 'live') return { ...(await callLive(input)), source: 'live' };
  if (mode === 'auto') {
    try {
      return { ...(await callLive(input)), source: 'live' };
    } catch (err) {
      console.warn(`[ml] ml-service gagal (${err.message}), memakai mock`);
    }
  }
  return { ...predictMock(input), source: 'mock' };
}

module.exports = { predict, normalizeModel };
