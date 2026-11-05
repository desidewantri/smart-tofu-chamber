const { classifyShelfLife, classifyParam, remainingSeconds, DEFAULT_ZONES } = require('./status');

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

/** Bentuk sesi yang dikirim ke frontend (dengan sisa waktu & status terhitung). */
function sessionView(doc, zones = DEFAULT_ZONES, now = Date.now(), experimentStartedAt = null) {
  const s = plain(doc);
  if (!s) return null;
  const end = s.selesai ? new Date(s.selesai).getTime() : now;
  const sisa = remainingSeconds(s, now);
  const expStartMs = experimentStartedAt ? new Date(experimentStartedAt).getTime() : null;
  const firstReadingMs = s.masuk ? new Date(s.masuk).getTime() : null;
  // New experiments use the shared experiment start; legacy sessions fall back
  // to their first-reading audit timestamp.
  const startMs = expStartMs ?? firstReadingMs;
  return {
    id: String(s._id),
    sesiCode: s.sesiCode,
    experimentId: s.experimentId ? String(s.experimentId) : null,
    experimentStartedAt: experimentStartedAt || null,
    chamberId: s.chamberId,
    status: s.status,
    sampleStatus: s.sampleStatus || 'UNKNOWN',
    sampleStatusUpdatedAt: s.sampleStatusUpdatedAt || null,
    storageCondition: s.storageCondition || 'DRY',
    masuk: s.masuk || null,
    selesai: s.selesai || null,
    durasiDetik: startMs === null ? null : Math.max(0, Math.round((end - startMs) / 1000)),
    // Elapsed since the shared experiment start; null for historical sessions.
    elapsedHours: expStartMs === null ? null : Math.round(((end - expStartMs) / 3600000) * 100) / 100,
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

/** Bentuk eksperimen untuk API. */
function experimentView(doc) {
  const e = plain(doc);
  if (!e) return null;
  return {
    id: String(e._id),
    label: e.label || null,
    startedAt: e.startedAt,
    endedAt: e.endedAt || null,
    status: e.status,
    chamberIds: e.chamberIds || [],
    storageCondition: e.storageCondition || 'DRY',
    rslSnapshotStatus: e.rslSnapshotStatus || null,
    rslSnapshotExpectedCount: e.rslSnapshotExpectedCount ?? 2,
    rslSnapshotCompletedCount: e.rslSnapshotCompletedCount ?? 0,
    rslSnapshotLastAttemptAt: e.rslSnapshotLastAttemptAt || null,
    rslSnapshotLastErrorCode: e.rslSnapshotLastErrorCode || null,
    rslSnapshotRecoveredAt: e.rslSnapshotRecoveredAt || null,
    finalizationStatus: e.finalizationStatus || null,
    finalizationExpectedSessionCount: e.finalizationExpectedSessionCount ?? 2,
    finalizationClosedSessionCount: e.finalizationClosedSessionCount ?? 0,
    finalizationLastAttemptAt: e.finalizationLastAttemptAt || null,
    finalizationLastErrorCode: e.finalizationLastErrorCode || null,
    finalizationRecoveredAt: e.finalizationRecoveredAt || null,
  };
}

function readingView(doc) {
  const r = plain(doc);
  if (!r) return null;
  return {
    id: String(r._id),
    chamberId: r.chamberId,
    sesiId: r.sesiId ? String(r.sesiId) : null,
    tvoc: r.tvoc,
    suhu: r.suhu,
    rh: r.rh,
    // timestamp tetap waktu efektif (sample time bila ada) agar UI lama tidak berubah.
    timestamp: r.timestamp,
    sampleId: r.sampleId || null,
    deviceId: r.deviceId || null,
    sampledAt: r.sampledAt || null,
    receivedAt: r.receivedAt || null,
    timestampSource: r.timestampSource || null,
    timestampQuality: r.timestampQuality || null,
    source: r.source || null,
    sources: r.sources || (r.source ? [r.source] : []),
  };
}

/** Persisted final RSL snapshot for a completed experiment. */
function rslSnapshotView(doc) {
  const s = plain(doc);
  if (!s) return null;
  return {
    id: String(s._id),
    isSnapshot: true,
    schemaVersion: s.schemaVersion || 1,
    experimentId: s.experimentId ? String(s.experimentId) : null,
    sessionId: s.sessionId ? String(s.sessionId) : null,
    chamberId: s.chamberId,
    experimentLabel: s.experimentLabel || null,
    sesiCode: s.sesiCode || null,
    storageCondition: s.storageCondition || 'DRY',
    snapshotAt: s.snapshotAt || null,
    endedAt: s.endedAt || null,
    elapsedHours: s.elapsedHours ?? null,
    sampleStatus: s.sampleStatus || 'UNKNOWN',
    sampleStatusUpdatedAt: s.sampleStatusUpdatedAt || null,
    status: s.status,
    reason: s.reason || null,
    message: s.message || null,
    primary: s.primary || null,
    supporting: s.supporting || null,
    metadata: s.metadata || null,
    timestampQuality: s.timestampQuality || null,
    lastReadingAt: s.lastReadingAt || null,
    readingCount: s.readingCount || 0,
  };
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

module.exports = { sessionView, experimentView, readingView, rslSnapshotView, sensorZones, chamberView, isConnected, downsample };
