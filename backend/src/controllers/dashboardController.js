const Chamber = require('../models/Chamber');
const Session = require('../models/Session');
const SensorReading = require('../models/SensorReading');
const Prediction = require('../models/Prediction');
const SystemSetting = require('../models/SystemSetting');
const asyncHandler = require('../utils/asyncHandler');
const { STATUS, classifyShelfLife, remainingSeconds } = require('../utils/status');
const { sessionView, readingView, sensorZones, chamberView, downsample } = require('../utils/presenters');

/** GET /api/dashboard : satu panggilan untuk semua kartu "Chambers Aktif". */
exports.dashboard = asyncHandler(async (_req, res) => {
  const settings = await SystemSetting.get();
  const now = Date.now();
  const chambers = await Chamber.find().sort({ chamberId: 1 });
  const sessions = await Session.find({ status: 'aktif' });
  const byChamber = new Map(sessions.map((s) => [s.chamberId, s]));

  const cards = await Promise.all(
    chambers.map(async (c) => {
      const session = byChamber.get(c.chamberId) || null;
      const base = { chamber: chamberView(c, settings, now), session: null, sensors: null, latestReading: null, chart: [] };
      if (!session) return base;

      const [latest, preds] = await Promise.all([
        SensorReading.findOne({ sesiId: session._id }).sort({ timestamp: -1 }).lean(),
        Prediction.find({ sesiId: session._id }).sort({ prediksiDibuat: 1 }).lean(),
      ]);
      const t0 = new Date(session.masuk).getTime();
      const chart = downsample(
        preds.map((p) => ({
          elapsedHours: Math.round(((new Date(p.prediksiDibuat) - t0) / 3600000) * 100) / 100,
          shelfLife: p.shelfLifeJam,
        })),
        200
      );
      return {
        ...base,
        session: sessionView(session, settings.zones, now),
        latestReading: readingView(latest),
        sensors: sensorZones(latest, settings.thresholds),
        chart,
      };
    })
  );

  // Sesi dengan sisa waktu terkecil tampil lebih dulu (sesuai proposal).
  const active = cards
    .filter((c) => c.session)
    .sort((a, b) => (a.session.sisaDetik ?? Infinity) - (b.session.sisaDetik ?? Infinity));
  const idle = cards.filter((c) => !c.session);

  res.json({
    success: true,
    data: {
      serverTime: new Date(now).toISOString(),
      refreshSeconds: 10,
      updateIntervalMinutes: settings.updateIntervalMinutes,
      zones: settings.zones,
      thresholds: settings.thresholds,
      active,
      idle,
    },
  });
});

/** GET /api/notifications : notifikasi turunan dari kondisi saat ini (tanpa koleksi tambahan). */
exports.notifications = asyncHandler(async (_req, res) => {
  const settings = await SystemSetting.get();
  const n = settings.notifications;
  const now = Date.now();
  const items = [];
  if (!n.enabled) return res.json({ success: true, data: [] });

  const chambers = await Chamber.find();
  const sessions = await Session.find({ status: 'aktif' });
  const chamberOf = new Map(chambers.map((c) => [c.chamberId, c]));

  sessions.forEach((s) => {
    const c = chamberOf.get(s.chamberId);
    const label = c ? c.name : `Chamber ${s.chamberId}`;
    const sisa = remainingSeconds(s.toObject(), now);
    const status = sisa === null ? null : classifyShelfLife(sisa / 3600, settings.zones);
    if (status === STATUS.TIDAK && n.onTidakLayak) {
      items.push({
        id: `tidak-${s._id}`, level: 'danger', chamberId: s.chamberId,
        title: `${label} Tidak Layak Jual`,
        message: `Sisa umur simpan ${s.sesiCode} kurang dari ${settings.zones.rawanHours} jam.`,
        time: s.prediksiDibuat,
      });
    } else if (status === STATUS.SEGERA && n.onSegeraJual) {
      items.push({
        id: `segera-${s._id}`, level: 'warning', chamberId: s.chamberId,
        title: `${label} Segera Jual`,
        message: `Sisa umur simpan ${s.sesiCode} kurang dari ${settings.zones.segarHours} jam.`,
        time: s.prediksiDibuat,
      });
    }
    if (n.onOffline && c && !chamberView(c, settings, now).connected) {
      items.push({
        id: `offline-${c._id}`, level: 'info', chamberId: c.chamberId,
        title: `${label} terputus`,
        message: 'Chamber dengan sesi aktif tidak mengirim data. Periksa koneksi perangkat.',
        time: c.lastSeenAt,
      });
    }
  });

  const order = { danger: 0, warning: 1, info: 2 };
  items.sort((a, b) => order[a.level] - order[b.level]);
  res.json({ success: true, data: items });
});

exports.health = (mqttStatus, env) =>
  asyncHandler(async (_req, res) => {
    const mongoose = require('mongoose');
    res.json({
      success: true,
      status: 'ok',
      db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      mqtt: mqttStatus(),
      mlMode: env.ml.mode,
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    });
  });

/** POST /api/notifications/whatsapp/test : kirim pesan uji ke nomor tersimpan (atau body.target). */
exports.testWhatsApp = asyncHandler(async (req, res) => {
  const { sendWhatsApp } = require('../services/whatsappService');
  const settings = await SystemSetting.get();
  const targets = req.body?.target ? [req.body.target] : settings.notifications?.whatsapp?.recipients || [];
  const message = [
    '*TOSCHA · Tofu Smart Chamber*',
    '✅ Pesan uji berhasil. Notifikasi WhatsApp sudah terhubung.',
    'Anda akan menerima pesan saat chamber masuk status Segera Jual, Tidak Layak Jual, atau terputus.',
  ].join('\n');
  const out = await sendWhatsApp(targets, message);
  res.json({
    success: true,
    message: out.provider === 'dry-run' ? 'Mode uji: pesan dicetak di terminal backend, tidak dikirim' : `Pesan uji dikirim ke ${out.targets.length} nomor`,
    data: out,
  });
});
