const { classifyShelfLife, classifyParam, remainingSeconds, DEFAULT_ZONES } = require('./status');

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

/** Bentuk sesi yang dikirim ke frontend (dengan sisa waktu & status terhitung). */
function sessionView(doc, zones = DEFAULT_ZONES, now = Date.now()) {
  const s = plain(doc);
  if (!s) return null;
  const end = s.selesai ? new Date(s.selesai).getTime() : now;
  const sisa = remainingSeconds(s, now);
  return {
    id: String(s._id),
    sesiCode: s.sesiCode,
    chamberId: s.chamberId,
    status: s.status,
    masuk: s.masuk,
    selesai: s.selesai || null,
    durasiDetik: Math.max(0, Math.round((end - new Date(s.masuk).getTime()) / 1000)),
    tvocAwal: s.tvoc_awal,
    suhuAwal: s.suhu_awal,
    rhAwal: s.rh_awal,
    shelfLifeMulai: s.shelfLifeMulai,
    shelfLifeJam: s.shelfLifeAwal,
    prediksiDibuat: s.prediksiDibuat,
    modelUsed: s.modelUsed,
    readingCount: s.readingCount || 0,
    sisaDetik: sisa,
    statusLayak: sisa === null ? null : classifyShelfLife(sisa / 3600, zones),
    statusAkhir: s.statusAkhir || null,
    sisaAkhirJam: s.sisaAkhirJam ?? null,
  };
}

function readingView(doc) {
  const r = plain(doc);
  if (!r) return null;
  return { id: String(r._id), chamberId: r.chamberId, tvoc: r.tvoc, suhu: r.suhu, rh: r.rh, timestamp: r.timestamp };
}

function sensorZones(reading, thresholds) {
  if (!reading) return null;
  return {
    tvoc: { value: reading.tvoc, unit: 'ppb', zone: classifyParam(reading.tvoc, thresholds.tvoc) },
    suhu: { value: reading.suhu, unit: '°C', zone: classifyParam(reading.suhu, thresholds.suhu) },
    rh: { value: reading.rh, unit: '%', zone: classifyParam(reading.rh, thresholds.rh) },
  };
}

function isConnected(chamber, settings, now = Date.now()) {
  if (!chamber.lastSeenAt) return false;
  const windowMs = (settings.updateIntervalMinutes || 5) * 60000 * 3;
  return now - new Date(chamber.lastSeenAt).getTime() < windowMs;
}

function chamberView(doc, settings, now = Date.now()) {
  const c = plain(doc);
  return {
    id: String(c._id),
    chamberId: c.chamberId,
    code: c.code,
    name: c.name,
    enabled: c.enabled,
    connected: isConnected(c, settings, now),
    lastSeenAt: c.lastSeenAt || null,
  };
}

/** Kurangi jumlah titik agar grafik ringan (ambil tiap k-titik, selalu sertakan titik terakhir). */
function downsample(arr, max = 300) {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  const out = arr.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

module.exports = { sessionView, readingView, sensorZones, chamberView, isConnected, downsample };
