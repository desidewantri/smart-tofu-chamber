/**
 * Adapter between the Node API and the internal Python RSL service.
 *
 * This module deliberately does not import or reimplement M1/M2/M3. It only:
 *  - resolves the experiment/session context and canonical elapsed time,
 *  - enforces explicit operator sample status and storage condition,
 *  - calls the long-running Python service with a bounded timeout,
 *  - validates and normalizes the canonical engine response for the API.
 *
 * Sensor values (TVOC/RH/temperature) are never sent to the engine.
 */
const env = require('../config/env');
const Experiment = require('../models/Experiment');
const Session = require('../models/Session');
const ApiError = require('../utils/ApiError');

const SAMPLE_STATUSES = ['UNKNOWN', 'NOT_SPOILED', 'SPOILED'];
const STORAGE_CONDITIONS = ['DRY', 'WATER', 'UNKNOWN'];
const ENGINE_STATUS_TO_REASON = {
  SAMPLE_REPORTED_SPOILED: 'SAMPLE_REPORTED_SPOILED',
  UNSUPPORTED_CONDITION: 'UNSUPPORTED_STORAGE_CONDITION',
  OUTSIDE_SUPPORT: 'OUTSIDE_REFERENCE_SUPPORT',
};

const nowMs = (value) => {
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

function validateSampleStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  if (!SAMPLE_STATUSES.includes(status)) {
    throw new ApiError(400, 'sampleStatus harus UNKNOWN, NOT_SPOILED, atau SPOILED', {
      code: 'INVALID_SAMPLE_STATUS',
    });
  }
  return status;
}

function validateStorageCondition(value, fallback = null) {
  if (value === undefined || value === null || value === '') {
    if (fallback) return fallback;
    throw new ApiError(400, 'storageCondition wajib diisi', {
      code: 'INVALID_STORAGE_CONDITION',
    });
  }
  const condition = String(value).trim().toUpperCase();
  if (!STORAGE_CONDITIONS.includes(condition)) {
    throw new ApiError(400, 'storageCondition harus DRY, WATER, atau UNKNOWN', {
      code: 'INVALID_STORAGE_CONDITION',
    });
  }
  return condition;
}

function baseContext({ experiment, session, elapsedHours, now }) {
  return {
    experimentId: experiment ? String(experiment._id || experiment.id) : null,
    sessionId: session ? String(session._id || session.id) : null,
    chamberId: session ? Number(session.chamberId) : null,
    sampleStatus: session?.sampleStatus || 'UNKNOWN',
    storageCondition: session?.storageCondition || experiment?.storageCondition || 'DRY',
    elapsedHours: elapsedHours === null || elapsedHours === undefined ? null : elapsedHours,
    generatedAt: new Date(now).toISOString(),
  };
}

function unavailable(context, reason, message, extra = {}) {
  return {
    ...context,
    status: 'UNAVAILABLE',
    reason,
    message,
    primary: null,
    supporting: null,
    metadata: {
      engineVersion: null,
      referenceVersion: null,
      referencePopulation: 3,
      referenceStorageCondition: 'DRY',
      elapsedOrigin: 'EXPERIMENT_STARTED_AT',
      tvocContribution: 'NOT_ESTABLISHED',
      caveats: [],
      ...extra,
    },
  };
}

function roundDown(value) {
  return Math.floor(Number(value) + 1e-12);
}

function roundUp(value) {
  return Math.ceil(Number(value) - 1e-12);
}

function normalizeM2(method) {
  if (!method || typeof method !== 'object') return null;
  return {
    method: method.method || 'M2_TURNBULL_NPMLE',
    label: method.label || 'TURNBULL_NPMLE_CONDITIONAL_SUPPORT',
    status: method.status || 'NOT_AVAILABLE',
    advisory: method.advisory || null,
    note: method.note || null,
    components: Array.isArray(method.components)
      ? method.components.map((component) => ({
          lowerHours: component.lower_h,
          upperHours: component.upper_h,
          mass: component.mass,
        }))
      : [],
  };
}

function normalizeM3(method) {
  if (!method || typeof method !== 'object') return null;
  return {
    method: method.method || 'M3_WEIBULL_A0',
    label: method.label || 'WEIBULL_A0_PARAMETRIC_COMPARATOR',
    status: method.status || 'NOT_AVAILABLE',
    available: Boolean(method.available),
    shape: method.shape ?? null,
    scale: method.scale ?? null,
    r10Hours: method.r10_h ?? null,
    r90Hours: method.r90_h ?? null,
    supportWarning: method.support_warning ?? null,
    suppressFromDashboard: Boolean(method.suppress_from_dashboard),
    note: method.note || null,
  };
}

function normalizeEngineResponse(engineResponse, context) {
  if (!engineResponse || typeof engineResponse !== 'object') {
    return unavailable(context, 'ENGINE_INVALID_RESPONSE', 'Respons engine RSL tidak valid');
  }
  const data = engineResponse.data;
  if (!data || typeof data !== 'object' || typeof data.status !== 'string') {
    return unavailable(context, 'ENGINE_INVALID_RESPONSE', 'Respons engine RSL tidak valid');
  }

  const metadata = {
    engineVersion: engineResponse.metadata?.engineVersion || null,
    referenceVersion: engineResponse.metadata?.referenceVersion || null,
    referencePopulation: engineResponse.metadata?.referencePopulation ?? 3,
    referenceStorageCondition: engineResponse.metadata?.referenceStorageCondition || 'DRY',
    elapsedOrigin: 'EXPERIMENT_STARTED_AT',
    tvocContribution: data.tvoc_contribution || 'NOT_ESTABLISHED',
    caveats: Array.isArray(data.caveats) ? data.caveats : [],
    researchStatus: engineResponse.metadata?.researchStatus || null,
    interpretation: data.primary_rsl?.interpretation || null,
    note: data.note || null,
  };

  if (data.status !== 'OK') {
    const reason = ENGINE_STATUS_TO_REASON[data.status] || 'ENGINE_UNAVAILABLE';
    return {
      ...context,
      status: 'UNAVAILABLE',
      reason,
      message:
        reason === 'SAMPLE_REPORTED_SPOILED'
          ? 'Sampel dilaporkan rusak; estimasi sisa umur tidak tersedia.'
          : reason === 'UNSUPPORTED_STORAGE_CONDITION'
            ? 'Kondisi penyimpanan ini tidak didukung oleh referensi DRY.'
            : reason === 'OUTSIDE_REFERENCE_SUPPORT'
              ? 'Waktu berjalan sudah di luar dukungan referensi historis.'
              : 'Estimasi RSL tidak tersedia.',
      primary: null,
      supporting: {
        M2: normalizeM2(data.methods?.M2),
        M3: normalizeM3(data.methods?.M3),
      },
      metadata,
    };
  }

  const lower = Number(data.primary_rsl?.lower_h);
  const upper = Number(data.primary_rsl?.upper_h);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower < 0 || upper < lower) {
    return unavailable(context, 'ENGINE_INVALID_RESPONSE', 'Batas M1 tidak valid', metadata);
  }

  return {
    ...context,
    status: 'AVAILABLE',
    reason: null,
    message: null,
    primary: {
      method: 'M1',
      engineMethod: data.primary_method || 'M1_EMPIRICAL_ENVELOPE',
      lowerHours: lower,
      upperHours: upper,
      display: { lowerHours: roundDown(lower), upperHours: roundUp(upper) },
      interpretation: data.primary_rsl?.interpretation || 'EMPIRICAL_INTERVAL_ENVELOPE',
      label: data.methods?.M1?.label || null,
      nReferenceSessions: data.n_reference_sessions,
      nAtRiskSessions: data.n_at_risk_sessions,
    },
    supporting: {
      M2: normalizeM2(data.methods?.M2),
      M3: normalizeM3(data.methods?.M3),
    },
    metadata,
  };
}

async function callEngine(body, { config = env.rsl, fetchImpl = global.fetch } = {}) {
  if (!config.enabled) {
    throw Object.assign(new Error('RSL service dinonaktifkan'), { code: 'RSL_DISABLED' });
  }
  if (typeof fetchImpl !== 'function') {
    throw Object.assign(new Error('fetch tidak tersedia'), { code: 'RSL_UNAVAILABLE' });
  }
  let response;
  try {
    response = await fetchImpl(`${config.url}/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (err) {
    const cause = String(err?.cause?.code || '');
    const code = err?.name === 'TimeoutError'
      ? 'RSL_TIMEOUT'
      : cause === 'ECONNREFUSED' || cause === 'ECONNRESET'
        ? 'RSL_UNAVAILABLE'
        : 'RSL_UNAVAILABLE';
    throw Object.assign(new Error(`RSL service tidak dapat dihubungi (${err.message})`), { code });
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = payload?.error?.code || `RSL_HTTP_${response.status}`;
    throw Object.assign(new Error(payload?.error?.message || `RSL service HTTP ${response.status}`), {
      code,
    });
  }
  return payload;
}

/**
 * Resolve one chamber's RSL from the active experiment. The elapsed clock is
 * always the shared Experiment.startedAt, never Session.masuk or sensor data.
 */
async function estimateForSession(
  { experiment, session, now = Date.now(), allowClosed = false },
  { config = env.rsl, fetchImpl = global.fetch } = {}
) {
  const startedMs = nowMs(experiment?.startedAt);
  const context = baseContext({
    experiment,
    session,
    elapsedHours: startedMs === null ? null : (now - startedMs) / 3600000,
    now,
  });

  if (!experiment || !session) {
    return unavailable(context, 'NO_ACTIVE_EXPERIMENT', 'Tidak ada eksperimen aktif');
  }
  if (!allowClosed && experiment.status !== 'aktif') {
    return unavailable(context, 'EXPERIMENT_CLOSED', 'Eksperimen sudah selesai');
  }
  if (!allowClosed && session.status !== 'aktif') {
    return unavailable(context, 'NO_ACTIVE_SESSION', 'Sesi chamber tidak aktif');
  }
  if (startedMs === null) {
    return unavailable(context, 'INVALID_EXPERIMENT_START', 'Waktu mulai eksperimen tidak valid');
  }
  if (context.elapsedHours < 0) {
    return unavailable(context, 'NEGATIVE_ELAPSED_TIME', 'Waktu berjalan negatif');
  }
  if (context.storageCondition !== 'DRY') {
    return unavailable(
      context,
      'UNSUPPORTED_STORAGE_CONDITION',
      'Kondisi penyimpanan ini tidak didukung oleh referensi DRY'
    );
  }
  // Reference-only path for unverified samples. The stored status stays
  // UNKNOWN; the adapter queries the same DRY reference used for NOT_SPOILED
  // but labels the result as unverified reference information, never as an
  // individualized prediction or a confirmed sample condition.
  if (context.sampleStatus === 'UNKNOWN') {
    try {
      const engineResponse = await callEngine(
        {
          elapsedHours: context.elapsedHours,
          sampleStatus: 'NOT_SPOILED',
          storageCondition: context.storageCondition,
        },
        { config, fetchImpl }
      );
      const normalized = normalizeEngineResponse(engineResponse, context);
      if (normalized.status !== 'AVAILABLE' || !normalized.primary) {
        return {
          ...normalized,
          sampleStatus: 'UNKNOWN',
          referenceOnly: false,
        };
      }
      return {
        ...normalized,
        status: 'REFERENCE_ONLY',
        reason: 'SAMPLE_STATUS_UNKNOWN',
        message:
          'Rentang referensi historis untuk sampel yang belum diverifikasi; bukan prediksi individual.',
        sampleStatus: 'UNKNOWN',
        referenceOnly: true,
      };
    } catch (err) {
      const reason = ['RSL_TIMEOUT', 'RSL_UNAVAILABLE', 'RSL_DISABLED'].includes(err.code)
        ? err.code
        : 'ENGINE_UNAVAILABLE';
      return unavailable(context, reason, 'Layanan estimasi RSL tidak tersedia');
    }
  }

  try {
    const engineResponse = await callEngine(
      {
        elapsedHours: context.elapsedHours,
        sampleStatus: context.sampleStatus,
        storageCondition: context.storageCondition,
      },
      { config, fetchImpl }
    );
    return normalizeEngineResponse(engineResponse, context);
  } catch (err) {
    const reason = ['RSL_TIMEOUT', 'RSL_UNAVAILABLE', 'RSL_DISABLED'].includes(err.code)
      ? err.code
      : 'ENGINE_UNAVAILABLE';
    return unavailable(context, reason, 'Layanan estimasi RSL tidak tersedia');
  }
}

async function estimateForExperimentChamber(
  experimentId,
  chamberId,
  { now = Date.now(), config = env.rsl, fetchImpl = global.fetch, models = null } = {}
) {
  const ExperimentModel = models?.Experiment || Experiment;
  const SessionModel = models?.Session || Session;
  const experiment = await ExperimentModel.findById(experimentId);
  if (!experiment) throw new ApiError(404, 'Eksperimen tidak ditemukan');
  const session = await SessionModel.findOne({
    experimentId: experiment._id,
    chamberId: Number(chamberId),
    status: 'aktif',
  });
  if (!session) {
    throw new ApiError(404, 'Sesi chamber aktif tidak ditemukan untuk eksperimen ini');
  }
  return estimateForSession({ experiment, session, now }, { config, fetchImpl });
}

async function updateSampleStatus(
  { experimentId, sessionId, sampleStatus, storageCondition, userId = null, now = new Date() },
  { models = null } = {}
) {
  const ExperimentModel = models?.Experiment || Experiment;
  const SessionModel = models?.Session || Session;
  const experiment = await ExperimentModel.findById(experimentId);
  if (!experiment) throw new ApiError(404, 'Eksperimen tidak ditemukan');
  const session = await SessionModel.findOne({ _id: sessionId, experimentId: experiment._id });
  if (!session) throw new ApiError(404, 'Sesi tidak ditemukan pada eksperimen ini');
  if (experiment.status !== 'aktif') {
    throw new ApiError(409, 'Eksperimen sudah selesai; status sampel tidak dapat diubah', {
      code: 'EXPERIMENT_CLOSED',
    });
  }
  if (experiment.finalizationStatus === 'PENDING') {
    throw new ApiError(409, 'Finalisasi eksperimen sedang dipulihkan', {
      code: 'FINALIZATION_PENDING',
    });
  }
  if (session.status !== 'aktif') {
    throw new ApiError(409, 'Sesi sudah selesai; status sampel tidak dapat diubah', {
      code: 'SESSION_CLOSED',
    });
  }

  const status = validateSampleStatus(sampleStatus);
  const condition =
    storageCondition === undefined
      ? session.storageCondition || experiment.storageCondition || 'DRY'
      : validateStorageCondition(storageCondition);

  const updated = await SessionModel.findByIdAndUpdate(
    session._id,
    {
      $set: {
        sampleStatus: status,
        sampleStatusUpdatedAt: now,
        sampleStatusUpdatedBy: userId || null,
        storageCondition: condition,
      },
      $push: {
        sampleStatusHistory: { status, at: now, by: userId || null },
      },
    },
    { new: true }
  );
  if (!updated) throw new ApiError(404, 'Sesi tidak ditemukan saat memperbarui status');
  return { experiment, session: updated };
}

async function engineHealth({ config = env.rsl, fetchImpl = global.fetch } = {}) {
  if (!config.enabled) return { enabled: false, status: 'disabled', url: config.url };
  try {
    const response = await fetchImpl(`${config.url}/health`, {
      signal: AbortSignal.timeout(Math.min(config.timeoutMs, 1000)),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) throw new Error(`HTTP ${response.status}`);
    return { enabled: true, status: 'ok', ...payload, url: config.url };
  } catch (err) {
    return { enabled: true, status: 'unavailable', error: err.message, url: config.url };
  }
}

module.exports = {
  SAMPLE_STATUSES,
  STORAGE_CONDITIONS,
  callEngine,
  engineHealth,
  estimateForExperimentChamber,
  estimateForSession,
  normalizeEngineResponse,
  normalizeM2,
  normalizeM3,
  updateSampleStatus,
  validateSampleStatus,
  validateStorageCondition,
};
