const ApiError = require('./ApiError');

/**
 * Canonical event identity and sample-time semantics.
 *
 * One sampling cycle produces one `sample_id`. Each chamber reading of that
 * cycle is a distinct logical event: `<sample_id>-ch1` / `<sample_id>-ch2`.
 * The Google Sheets row carries the same `sample_id`, so the fallback importer
 * derives exactly the same event id without approximate timestamp matching.
 */

const SAMPLE_ID_MAX = 96;
const EVENT_ID_MAX = 160;
const DEVICE_ID_MAX = 64;
const ALLOWED = /^[A-Za-z0-9._:-]+$/;
// Firmware uses NTP. A 15-minute allowance absorbs ordinary clock skew and
// network delay while preventing a badly future-dated sample from moving
// prediction/audit state forward by hours. Larger skew is flagged INVALID and
// the server receipt time is used instead.
const FUTURE_TOLERANCE_MS = 15 * 60 * 1000;

function sanitiseSampleId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ApiError(400, 'sample_id harus berupa teks');
  }
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > SAMPLE_ID_MAX) {
    throw new ApiError(400, `sample_id maksimal ${SAMPLE_ID_MAX} karakter`);
  }
  if (!ALLOWED.test(text)) {
    throw new ApiError(400, 'sample_id hanya boleh berisi huruf, angka, titik, titik dua, garis bawah, atau strip');
  }
  return text;
}

function sanitiseDeviceId(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > DEVICE_ID_MAX) {
    throw new ApiError(400, `device_id maksimal ${DEVICE_ID_MAX} karakter`);
  }
  if (!ALLOWED.test(text)) {
    throw new ApiError(400, 'device_id mengandung karakter yang tidak diizinkan');
  }
  return text;
}

function deriveEventId(sampleId, chamberId) {
  const sample = sanitiseSampleId(sampleId);
  if (!sample) throw new ApiError(400, 'sample_id wajib ada untuk membentuk event_id');
  if (chamberId !== 1 && chamberId !== 2) {
    throw new ApiError(400, 'chamber_id harus 1 atau 2');
  }
  return `${sample}-ch${chamberId}`;
}

function sanitiseEventId(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > EVENT_ID_MAX) {
    throw new ApiError(400, `event_id maksimal ${EVENT_ID_MAX} karakter`);
  }
  if (!ALLOWED.test(text)) {
    throw new ApiError(400, 'event_id mengandung karakter yang tidak diizinkan');
  }
  return text;
}

function resolveEventIdentity(payload = {}, chamberId) {
  const sampleId = sanitiseSampleId(payload.sample_id);
  const deviceId = sanitiseDeviceId(payload.device_id);
  const explicit = sanitiseEventId(payload.event_id);

  if (sampleId) {
    const eventId = deriveEventId(sampleId, chamberId);
    if (explicit && explicit !== eventId) {
      throw new ApiError(400, `event_id (${explicit}) tidak cocok dengan sample_id + chamber_id (${eventId})`);
    }
    return { sampleId, deviceId, eventId, identitySource: 'sample_id' };
  }
  if (explicit) {
    return { sampleId: null, deviceId, eventId: explicit, identitySource: 'event_id' };
  }
  return { sampleId: null, deviceId, eventId: null, identitySource: 'absent' };
}

function parseDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Resolve the effective ordering timestamp.
 *
 * - valid `sampled_at` (or legacy `timestamp`) → that time, source `sampled`
 * - missing/invalid → reception time, source `received_at`, quality flagged
 *
 * `timestamp` is always safe to sort on; `sampledAt` stays null when the device
 * did not provide a usable sample time, so callers can tell the two apart.
 */
function resolveSampleTime(payload = {}, receivedAt = new Date()) {
  const received = receivedAt instanceof Date ? new Date(receivedAt.getTime()) : new Date(receivedAt);
  if (Number.isNaN(received.getTime())) {
    throw new ApiError(400, 'receivedAt tidak valid');
  }
  const raw = payload.sampled_at ?? payload.timestamp;
  if (raw === undefined || raw === null || raw === '') {
    return {
      sampledAt: null,
      timestamp: received,
      receivedAt: received,
      timestampSource: 'received_at',
      timestampQuality: 'MISSING',
    };
  }
  const parsed = parseDate(raw);
  if (!parsed) {
    return {
      sampledAt: null,
      timestamp: received,
      receivedAt: received,
      timestampSource: 'received_at',
      timestampQuality: 'INVALID',
      rejectedSampleTime: String(raw),
    };
  }
  if (parsed.getTime() > received.getTime() + FUTURE_TOLERANCE_MS) {
    return {
      sampledAt: null,
      timestamp: received,
      receivedAt: received,
      timestampSource: 'received_at',
      timestampQuality: 'INVALID',
      rejectedSampleTime: String(raw),
    };
  }
  return {
    sampledAt: parsed,
    timestamp: parsed,
    receivedAt: received,
    timestampSource: 'sampled',
    timestampQuality: 'OK',
  };
}

module.exports = {
  FUTURE_TOLERANCE_MS,
  deriveEventId,
  resolveEventIdentity,
  resolveSampleTime,
  sanitiseDeviceId,
  sanitiseEventId,
  sanitiseSampleId,
};
