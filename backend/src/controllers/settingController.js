const SystemSetting = require('../models/SystemSetting');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');
const { normalizePhone, isConfigured } = require('../services/whatsappService');

const ALLOWED = [
  'appName',
  'appDescription',
  'updateIntervalMinutes',
  'zones',
  'notifications',
  'thresholds',
  'business',
];

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** { a: { b: 1 } } -> { "a.b": 1 } agar update bersifat parsial (tidak menimpa objek). */
function flatten(obj, prefix = '', out = {}) {
  Object.entries(obj).forEach(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isPlain(v)) flatten(v, key, out);
    else out[key] = v;
  });
  return out;
}

const toObj = (doc) => {
  const o = doc.toObject();
  delete o.__v;
  // Info untuk halaman Pengaturan: apakah backend siap mengirim WhatsApp (token tidak pernah dikirim ke browser).
  o.whatsappStatus = { configured: isConfigured(), dryRun: env.whatsapp.dryRun, provider: env.whatsapp.provider };
  return o;
};

exports.get = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: toObj(await SystemSetting.get()) });
});

exports.update = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const picked = {};
  ALLOWED.forEach((k) => {
    if (body[k] !== undefined) picked[k] = body[k];
  });
  if (!Object.keys(picked).length) throw new ApiError(400, 'Tidak ada field yang bisa diperbarui');

  const current = toObj(await SystemSetting.get());
  const merged = {
    ...current,
    ...picked,
    zones: { ...current.zones, ...(picked.zones || {}) },
  };

  if (picked.updateIntervalMinutes !== undefined) {
    const n = Number(picked.updateIntervalMinutes);
    if (!Number.isFinite(n) || n < 1 || n > 60) throw new ApiError(400, 'Interval harus 1-60 menit');
  }
  if (picked.zones) {
    const { segarHours, rawanHours } = merged.zones;
    if (!(rawanHours > 0 && segarHours > rawanHours)) {
      throw new ApiError(400, 'Batas segar harus lebih besar dari batas rawan, dan keduanya > 0');
    }
  }
  if (picked.thresholds) {
    Object.entries(picked.thresholds).forEach(([param, lim]) => {
      if (lim && lim.aman !== undefined && lim.perhatian !== undefined && !(Number(lim.perhatian) > Number(lim.aman))) {
        throw new ApiError(400, `Batas "perhatian" ${param} harus lebih besar dari batas "aman"`);
      }
    });
  }

  const wa = picked.notifications && picked.notifications.whatsapp;
  if (wa && wa.recipients !== undefined) {
    if (!Array.isArray(wa.recipients)) throw new ApiError(400, 'Daftar nomor WhatsApp harus berupa daftar');
    const clean = [];
    wa.recipients.forEach((r) => {
      const p = normalizePhone(r);
      if (!p) throw new ApiError(400, `Nomor WhatsApp tidak valid: ${r}`);
      if (!clean.includes(p)) clean.push(p);
    });
    if (clean.length > 5) throw new ApiError(400, 'Maksimal 5 nomor WhatsApp');
    wa.recipients = clean;
  }

  const doc = await SystemSetting.findOneAndUpdate(
    { key: 'default' },
    { $set: flatten(picked) },
    { new: true, runValidators: true, upsert: true, setDefaultsOnInsert: true }
  );
  res.json({ success: true, message: 'Pengaturan disimpan', data: toObj(doc) });
});
