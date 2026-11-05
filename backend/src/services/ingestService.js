const Chamber = require('../models/Chamber');
const Session = require('../models/Session');
const SensorReading = require('../models/SensorReading');
const Prediction = require('../models/Prediction');
const ApiError = require('../utils/ApiError');
const predictionService = require('./predictionService');
const { parseBattery } = require('../utils/battery');
const { resolveEventIdentity, resolveSampleTime } = require('../utils/identity');

const HISTORY_WINDOW = 12; // W = 12 langkah (60 menit) untuk LSTM
const FEATURE_WINDOW = 30; // ±2,5 jam data terakhir untuk fitur model mock

function num(v) {
  if (v === null || v === undefined || v === '') return NaN;
  return Number(v);
}

/** Sistem hanya punya 2 kelompok sensor: Chamber 1 dan Chamber 2. */
const MAX_CHAMBERS = 2;
const TVOC_MAX = 99999; // batas atas sensor AGS10 (ppb)

/**
 * Validasi payload sensor (dari MQTT, HTTP, atau hasil normalisasi Sheets).
 *
 * Mengembalikan nilai yang sudah divalidasi beserta identitas event dan
 * semantik waktu:
 *   eventId  = `<sample_id>-ch<n>` (null untuk payload lama tanpa identitas)
 *   timestamp = sampledAt bila alat mengirim waktu sampel yang sah,
 *               selain itu receivedAt dengan timestampQuality MISSING/INVALID.
 */
function validatePayload(p, topicChamberId, receivedAt = new Date()) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    throw new ApiError(400, 'Payload harus berupa objek JSON');
  }
  const chamberId = num(p.chamber_id ?? p.chamberId ?? topicChamberId);
  const tvoc = num(p.tvoc);
  const suhu = num(p.suhu ?? p.temperature);
  const rh = num(p.rh ?? p.humidity);

  if (!Number.isInteger(chamberId) || chamberId < 1 || chamberId > MAX_CHAMBERS) {
    throw new ApiError(400, `chamber_id harus 1 sampai ${MAX_CHAMBERS} (hanya ada ${MAX_CHAMBERS} chamber)`);
  }
  // Rentang ukur AGS10 adalah 0-99.999 ppb. Nilai tinggi justru muncul saat tahu membusuk,
  // jadi tidak boleh ditolak (batas lama 60.000 membuang data paling penting).
  if (!Number.isFinite(tvoc) || tvoc < 0 || tvoc > TVOC_MAX) {
    throw new ApiError(400, `tvoc harus 0-${TVOC_MAX} ppb`);
  }
  if (!Number.isFinite(suhu) || suhu < -20 || suhu > 80) {
    throw new ApiError(400, 'suhu di luar rentang (-20 s.d. 80 °C)');
  }
  if (!Number.isFinite(rh) || rh < 0 || rh > 100) {
    throw new ApiError(400, 'rh harus 0-100 %');
  }

  const received = receivedAt instanceof Date ? new Date(receivedAt.getTime()) : new Date(receivedAt);
  if (Number.isNaN(received.getTime())) throw new ApiError(400, 'receivedAt tidak valid');

  const time = resolveSampleTime(p, received);
  const identity = resolveEventIdentity(p, chamberId);
  const battery = parseBattery(p.battery ?? p.baterai ?? p.bat ?? p.vbat);

  return {
    chamberId,
    tvoc,
    suhu,
    rh,
    battery,
    // Timestamp efektif untuk pengurutan dan kompatibilitas API lama.
    timestamp: time.timestamp,
    sampledAt: time.sampledAt,
    receivedAt: time.receivedAt,
    timestampSource: time.timestampSource,
    timestampQuality: time.timestampQuality,
    rejectedSampleTime: time.rejectedSampleTime ?? null,
    sampleId: identity.sampleId,
    deviceId: identity.deviceId,
    eventId: identity.eventId,
    identitySource: identity.identitySource,
  };
}

async function createSession(data, SessionModel) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const last = await SessionModel.findOne().sort({ seq: -1 }).select('seq').lean();
    const seq = (last?.seq || 0) + 1;
    try {
      return await SessionModel.create({
        seq,
        sesiCode: SessionModel.codeFor(seq),
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
      const existing = await SessionModel.findOne({ chamberId: data.chamberId, status: 'aktif' });
      if (existing) return existing;
    }
  }
  throw new ApiError(500, 'Gagal membuat sesi baru');
}

/** Duplikat: catat provenance tambahan, jangan sentuh sesi/prediksi/hitungan. */
async function handleDuplicate(data, models, source) {
  const { Session, SensorReading } = models;
  const existing = await SensorReading.findOne({ eventId: data.eventId });
  if (!existing) return null; // rare: duplicate key without a readable row
  if (source) {
    await SensorReading.updateOne({ _id: existing._id }, { $addToSet: { sources: source } });
  }
  const session = existing.sesiId ? await Session.findById(existing.sesiId) : null;
  return { reading: existing, session, prediction: null, predictionError: null, duplicate: true };
}

/**
 * Alur ingest (proposal Bab 8):
 * 0) identitas event + waktu sampel
 * 1) bila event sudah ada -> duplikat, tidak ada efek samping
 * 2) validasi + simpan SensorReading (unique eventId)
 * 3) bila chamber belum punya sesi aktif -> buat sesi baru (satu sesi = satu batch tahu)
 * 4) panggil ML (atau mock) -> simpan Prediction
 * 5) update shelfLifeAwal & prediksiDibuat (t0) hanya bila waktu sampel lebih baru
 */
async function ingestReading(payload, {
  topicChamberId,
  seenAt,
  receivedAt = null,
  source = null,
} = {}, deps = null) {
  const models = deps?.models || { Chamber, Session, SensorReading, Prediction };
  const predictor = deps?.predictionService || predictionService;
  const { Chamber: ChamberModel, Session: SessionModel, SensorReading: ReadingModel,
    Prediction: PredictionModel } = models;

  // `seenAt` dipertahankan untuk kompatibilitas pemanggil lama; waktu terima
  // sekarang eksplisit dan tidak pernah dipakai sebagai waktu sampel.
  const receptionTime = receivedAt ? new Date(receivedAt) : (seenAt ? new Date(seenAt) : new Date());
  const data = validatePayload(payload, topicChamberId, receptionTime);

  if (data.eventId) {
    const duplicate = await handleDuplicate(data, models, source);
    if (duplicate) return duplicate;
  }

  let session = await SessionModel.findOne({ chamberId: data.chamberId, status: 'aktif' });
  if (!session) session = await createSession(data, SessionModel);

  let reading;
  try {
    reading = await ReadingModel.create({
      eventId: data.eventId,
      sampleId: data.sampleId,
      deviceId: data.deviceId,
      chamberId: data.chamberId,
      sesiId: session._id,
      tvoc: data.tvoc,
      suhu: data.suhu,
      rh: data.rh,
      battery: data.battery,
      timestamp: data.timestamp,
      sampledAt: data.sampledAt,
      receivedAt: data.receivedAt,
      timestampSource: data.timestampSource,
      timestampQuality: data.timestampQuality,
      source,
      sources: source ? [source] : [],
    });
  } catch (err) {
    if (err.code === 11000 && data.eventId) {
      // Lost a race with the same event from the other source.
      const duplicate = await handleDuplicate(data, models, source);
      if (duplicate) return duplicate;
    }
    throw err;
  }

  await ChamberModel.findOneAndUpdate(
    { chamberId: data.chamberId },
    {
      // lastSeenAt = kapan backend mendengar alat, bukan waktu sampel.
      $max: { lastSeenAt: data.receivedAt },
      $setOnInsert: {
        code: ChamberModel.codeFor(data.chamberId),
        name: `Chamber ${data.chamberId}`,
        enabled: true,
      },
    },
    { upsert: true, new: true }
  );
  if (data.battery !== null) {
    await ChamberModel.updateOne(
      { chamberId: data.chamberId, $or: [{ batteryAt: null }, { batteryAt: { $lte: data.timestamp } }] },
      { $set: { battery: data.battery, batteryAt: data.timestamp } }
    );
  }

  const nT = await ReadingModel.countDocuments({ sesiId: session._id });
  let prediction = null;
  let predictionError = null;

  try {
    const recent = await ReadingModel.find({ sesiId: session._id })
      .sort({ timestamp: -1 })
      .limit(FEATURE_WINDOW)
      .lean();
    recent.reverse();
    const history = recent
      .slice(-HISTORY_WINDOW)
      .map((r) => ({ tvoc: r.tvoc, suhu: r.suhu, rh: r.rh, timestamp: r.timestamp }));

    // Fitur untuk model mock: umur sesi, baseline TVOC (nilai terendah sesi), suhu rata-rata, TVOC 1,5 jam terakhir.
    const t0 = new Date(session.masuk).getTime();
    const hoursOf = (ts) => (new Date(ts).getTime() - t0) / 3600000;
    const lowest = await ReadingModel.findOne({ sesiId: session._id }).sort({ tvoc: 1 }).select('tvoc').lean();
    const suhuMean = recent.reduce((acc, r) => acc + r.suhu, 0) / Math.max(1, recent.length);
    const nowH = hoursOf(data.timestamp);
    const features = {
      hours: Math.max(0, nowH),
      tvocBaseline: lowest ? lowest.tvoc : data.tvoc,
      tempMean: recent.length ? suhuMean : data.suhu,
      readings: nT,
      recent: recent.filter((r) => hoursOf(r.timestamp) >= nowH - 1.5).map((r) => ({ hours: hoursOf(r.timestamp), tvoc: r.tvoc })),
    };

    const result = await predictor.predict({
      chamber_id: data.chamberId,
      session_id: session.sesiCode,
      tvoc: data.tvoc,
      suhu: data.suhu,
      rh: data.rh,
      n_t: nT,
      history,
      features,
    });

    // Prediksi dicatat pada waktu sampel, bukan waktu terima, agar grafik dan
    // hitung mundur tetap kronologis saat ada data terlambat.
    const predictionTime = data.timestamp;
    prediction = await PredictionModel.create({
      sesiId: session._id,
      chamberId: data.chamberId,
      tvoc_snapshot: data.tvoc,
      suhu_snapshot: data.suhu,
      rh_snapshot: data.rh,
      shelfLifeJam: result.shelfLifeJam,
      modelUsed: result.modelUsed,
      prediksiDibuat: predictionTime,
    });

    // Sesi hanya maju bila waktu sampel lebih baru dari t0 yang tersimpan.
    const currentT0 = session.prediksiDibuat ? new Date(session.prediksiDibuat).getTime() : null;
    const shouldAdvance = currentT0 === null || predictionTime.getTime() >= currentT0;
    const set = { readingCount: nT };
    if (shouldAdvance) {
      set.shelfLifeAwal = result.shelfLifeJam;
      set.prediksiDibuat = predictionTime;
      set.modelUsed = result.modelUsed;
    }
    if (session.shelfLifeMulai === null || session.shelfLifeMulai === undefined) {
      set.shelfLifeMulai = result.shelfLifeJam;
    }
    session = await SessionModel.findByIdAndUpdate(session._id, { $set: set }, { new: true });
  } catch (err) {
    predictionError = err.message;
    console.error(`[ingest] prediksi gagal untuk chamber ${data.chamberId}: ${err.message}`);
    session = await SessionModel.findByIdAndUpdate(session._id, { $set: { readingCount: nT } }, { new: true });
  }

  return { reading, session, prediction, predictionError, duplicate: false };
}

module.exports = { ingestReading, validatePayload, MAX_CHAMBERS, TVOC_MAX };
