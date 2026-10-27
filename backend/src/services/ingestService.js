const Chamber = require('../models/Chamber');
const Session = require('../models/Session');
const SensorReading = require('../models/SensorReading');
const Prediction = require('../models/Prediction');
const ApiError = require('../utils/ApiError');
const predictionService = require('./predictionService');

const HISTORY_WINDOW = 12; // W = 12 langkah (60 menit) untuk LSTM

function num(v) {
  if (v === null || v === undefined || v === '') return NaN;
  return Number(v);
}

/** Validasi payload sensor (dari MQTT atau HTTP). Melempar ApiError 400 bila tidak valid. */
function validatePayload(p, topicChamberId) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    throw new ApiError(400, 'Payload harus berupa objek JSON');
  }
  const chamberId = num(p.chamber_id ?? p.chamberId ?? topicChamberId);
  const tvoc = num(p.tvoc);
  const suhu = num(p.suhu ?? p.temperature);
  const rh = num(p.rh ?? p.humidity);

  if (!Number.isInteger(chamberId) || chamberId < 1) throw new ApiError(400, 'chamber_id harus bilangan bulat >= 1');
  if (!Number.isFinite(tvoc) || tvoc < 0 || tvoc > 60000) throw new ApiError(400, 'tvoc harus 0-60000 ppb');
  if (!Number.isFinite(suhu) || suhu < -20 || suhu > 80) throw new ApiError(400, 'suhu di luar rentang (-20 s.d. 80 °C)');
  if (!Number.isFinite(rh) || rh < 0 || rh > 100) throw new ApiError(400, 'rh harus 0-100 %');

  let timestamp = p.timestamp ? new Date(p.timestamp) : new Date();
  if (Number.isNaN(timestamp.getTime()) || timestamp.getTime() > Date.now() + 24 * 3600 * 1000) {
    timestamp = new Date();
  }
  return { chamberId, tvoc, suhu, rh, timestamp };
}

async function createSession(data) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const last = await Session.findOne().sort({ seq: -1 }).select('seq').lean();
    const seq = (last?.seq || 0) + 1;
    try {
      return await Session.create({
        seq,
        sesiCode: Session.codeFor(seq),
        chamberId: data.chamberId,
        status: 'aktif',
        masuk: data.timestamp,
        tvoc_awal: data.tvoc,
        suhu_awal: data.suhu,
        rh_awal: data.rh,
      });
    } catch (err) {
      if (err.code !== 11000) throw err;
      // Sesi aktif sudah dibuat oleh pesan lain secara bersamaan -> pakai itu.
      const existing = await Session.findOne({ chamberId: data.chamberId, status: 'aktif' });
      if (existing) return existing;
    }
  }
  throw new ApiError(500, 'Gagal membuat sesi baru');
}

/**
 * Alur ingest (proposal Bab 8):
 * 1) validasi + simpan SensorReading
 * 2) bila chamber belum punya sesi aktif -> buat sesi baru (satu sesi = satu batch tahu)
 * 3) panggil ML (atau mock) -> simpan Prediction
 * 4) update shelfLifeAwal & prediksiDibuat (t0) pada sesi
 */
async function ingestReading(payload, { topicChamberId } = {}) {
  const data = validatePayload(payload, topicChamberId);

  await Chamber.findOneAndUpdate(
    { chamberId: data.chamberId },
    {
      $set: { lastSeenAt: new Date() },
      $setOnInsert: {
        code: Chamber.codeFor(data.chamberId),
        name: `Chamber ${data.chamberId}`,
        enabled: true,
      },
    },
    { upsert: true, new: true }
  );

  let session = await Session.findOne({ chamberId: data.chamberId, status: 'aktif' });
  if (!session) session = await createSession(data);

  const reading = await SensorReading.create({
    chamberId: data.chamberId,
    sesiId: session._id,
    tvoc: data.tvoc,
    suhu: data.suhu,
    rh: data.rh,
    timestamp: data.timestamp,
  });

  const nT = await SensorReading.countDocuments({ sesiId: session._id });
  let prediction = null;
  let predictionError = null;

  try {
    const recent = await SensorReading.find({ sesiId: session._id })
      .sort({ timestamp: -1 })
      .limit(HISTORY_WINDOW)
      .lean();
    const history = recent
      .reverse()
      .map((r) => ({ tvoc: r.tvoc, suhu: r.suhu, rh: r.rh, timestamp: r.timestamp }));

    const result = await predictionService.predict({
      chamber_id: data.chamberId,
      session_id: session.sesiCode,
      tvoc: data.tvoc,
      suhu: data.suhu,
      rh: data.rh,
      n_t: nT,
      history,
    });

    const now = new Date();
    prediction = await Prediction.create({
      sesiId: session._id,
      chamberId: data.chamberId,
      tvoc_snapshot: data.tvoc,
      suhu_snapshot: data.suhu,
      rh_snapshot: data.rh,
      shelfLifeJam: result.shelfLifeJam,
      modelUsed: result.modelUsed,
      prediksiDibuat: now,
    });

    const set = {
      shelfLifeAwal: result.shelfLifeJam,
      prediksiDibuat: now,
      modelUsed: result.modelUsed,
      readingCount: nT,
    };
    if (session.shelfLifeMulai === null || session.shelfLifeMulai === undefined) {
      set.shelfLifeMulai = result.shelfLifeJam;
    }
    session = await Session.findByIdAndUpdate(session._id, { $set: set }, { new: true });
  } catch (err) {
    predictionError = err.message;
    console.error(`[ingest] prediksi gagal untuk chamber ${data.chamberId}: ${err.message}`);
    session = await Session.findByIdAndUpdate(session._id, { $set: { readingCount: nT } }, { new: true });
  }

  return { reading, session, prediction, predictionError };
}

module.exports = { ingestReading, validatePayload };
