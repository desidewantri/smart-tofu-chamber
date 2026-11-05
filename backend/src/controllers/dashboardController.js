const Chamber = require('../models/Chamber');
const Session = require('../models/Session');
const SensorReading = require('../models/SensorReading');
const Prediction = require('../models/Prediction');
const Experiment = require('../models/Experiment');
const NotificationEvent = require('../models/NotificationEvent');
const SystemSetting = require('../models/SystemSetting');
const asyncHandler = require('../utils/asyncHandler');
const { sessionView, experimentView, readingView, sensorZones, chamberView, downsample, isConnected } = require('../utils/presenters');
const { batteryLevel, LOW_PERCENT } = require('../utils/battery');
const rslService = require('../services/rslService');

/**
 * Status baterai alat: diambil dari chamber yang paling baru melaporkan baterai
 * (satu alat melayani Chamber 1 dan 2, jadi nilainya sama).
 */
async function batteryStatus(settings, now = Date.now()) {
  const c = await Chamber.findOne({ battery: { $ne: null } }).sort({ batteryAt: -1 }).lean();
  if (!c) return { percent: null, level: null, at: null, stale: false };
  return {
    percent: c.battery,
    level: batteryLevel(c.battery),
    at: c.batteryAt,
    stale: !isConnected({ lastSeenAt: c.batteryAt }, settings, now),
  };
}
exports.batteryStatus = batteryStatus;

/** GET /api/battery */
exports.battery = asyncHandler(async (_req, res) => {
  const settings = await SystemSetting.get();
  res.json({ success: true, data: await batteryStatus(settings) });
});

/** GET /api/dashboard : satu panggilan untuk semua kartu "Chambers Aktif". */
exports.dashboard = asyncHandler(async (_req, res) => {
  const settings = await SystemSetting.get();
  const now = Date.now();
  const chambers = await Chamber.find().sort({ chamberId: 1 });
  const sessions = await Session.find({ status: 'aktif' });
  const activeExperiment = await Experiment.findOne({ status: 'aktif' }).lean();
  const experimentStartedAt = activeExperiment?.startedAt || null;
  const byChamber = new Map(sessions.map((s) => [s.chamberId, s]));

  const cards = await Promise.all(
    chambers.map(async (c) => {
      const session = byChamber.get(c.chamberId) || null;
      const base = {
        chamber: chamberView(c, settings, now),
        session: null,
        sensors: null,
        latestReading: null,
        chart: [],
        rsl: null,
      };
      if (!session) return base;

      const [latest, preds, rsl] = await Promise.all([
        SensorReading.findOne({ sesiId: session._id }).sort({ timestamp: -1 }).lean(),
        Prediction.find({ sesiId: session._id }).sort({ prediksiDibuat: 1 }).lean(),
        // Legacy active sessions without experimentId keep their old dashboard
        // behavior; never attach fabricated experiment/RSL metadata to them.
        session.experimentId && activeExperiment &&
        String(session.experimentId) === String(activeExperiment._id)
          ? rslService.estimateForSession({ experiment: activeExperiment, session, now })
          : Promise.resolve(null),
      ]);
      const t0 = experimentStartedAt
        ? new Date(experimentStartedAt).getTime()
        : (session.masuk ? new Date(session.masuk).getTime() : null);
      const chart = downsample(
        preds.map((p) => ({
          elapsedHours: t0 === null ? null : Math.round(((new Date(p.prediksiDibuat) - t0) / 3600000) * 100) / 100,
          shelfLife: p.shelfLifeJam,
        })),
        200
      );
      return {
        ...base,
        session: sessionView(session, settings.zones, now, experimentStartedAt),
        latestReading: readingView(latest),
        sensors: sensorZones(latest, settings.thresholds),
        chart,
        rsl,
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
      experiment: experimentView(activeExperiment),
      active,
      idle,
    },
  });
});

/** GET /api/notifications : persisted RSL alerts + offline/battery context. */
exports.notifications = asyncHandler(async (_req, res) => {
  const settings = await SystemSetting.get();
  const now = Date.now();
  const items = [];
  const onOffline = settings.notifications?.onOffline !== false;
  const onLowBattery = settings.notifications?.onLowBattery !== false;

  const activeExperiment = await Experiment.findOne({ status: 'aktif' }).lean();
  if (activeExperiment) {
    const events = await NotificationEvent.find({ experimentId: activeExperiment._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    for (const e of events) {
      items.push({
        id: `rsl-${e._id}`,
        level: e.level,
        chamberId: e.chamberId,
        experimentId: String(e.experimentId),
        kind: e.kind,
        title: e.title,
        message: e.message,
        disclaimer: e.disclaimer || null,
        thresholdHours: e.thresholdHours,
        lowerHours: e.lowerHours,
        upperHours: e.upperHours,
        time: e.createdAt,
      });
    }
  }

  const chambers = await Chamber.find();
  const sessions = await Session.find({ status: 'aktif' });
  const chamberOf = new Map(chambers.map((c) => [c.chamberId, c]));

  if (onOffline) {
    for (const s of sessions) {
      const c = chamberOf.get(s.chamberId);
      if (!c || !c.enabled || !s.masuk) continue;
      if (!chamberView(c, settings, now).connected) {
        const label = c.name || `Chamber ${s.chamberId}`;
        items.push({
          id: `offline-${c._id}`,
          level: 'info',
          chamberId: c.chamberId,
          experimentId: s.experimentId ? String(s.experimentId) : null,
          kind: 'offline',
          title: `${label} terputus`,
          message: 'Chamber dengan sesi aktif tidak mengirim data. Periksa koneksi perangkat.',
          time: c.lastSeenAt,
        });
      }
    }
  }

  if (onLowBattery) {
    const b = await batteryStatus(settings, now);
    if (b.percent !== null && !b.stale && b.percent < LOW_PERCENT) {
      items.push({
        id: 'battery-low',
        level: 'warning',
        chamberId: null,
        experimentId: activeExperiment ? String(activeExperiment._id) : null,
        kind: 'battery_low',
        title: 'Baterai alat lemah',
        message: `Baterai tinggal ${b.percent}%. Segera isi daya agar sensor tetap mengirim data.`,
        time: b.at,
      });
    }
  }

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
      rsl: { enabled: env.rsl.enabled },
      rslSnapshotRecovery: require('../services/rslSnapshotService').status(),
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
    'Anda akan menerima pesan saat chamber masuk status Segera Konsumsi, Tidak Layak Konsumsi, atau terputus.',
  ].join('\n');
  const out = await sendWhatsApp(targets, message);
  res.json({
    success: true,
    message: out.provider === 'dry-run' ? 'Mode uji: pesan dicetak di terminal backend, tidak dikirim' : `Pesan uji dikirim ke ${out.targets.length} nomor`,
    data: out,
  });
});
