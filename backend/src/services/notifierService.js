const env = require('../config/env');
const Experiment = require('../models/Experiment');
const Chamber = require('../models/Chamber');
const Session = require('../models/Session');
const SensorReading = require('../models/SensorReading');
const NotificationEvent = require('../models/NotificationEvent');
const SystemSetting = require('../models/SystemSetting');
const { isConnected } = require('../utils/presenters');
const { sendWhatsApp, isConfigured } = require('./whatsappService');
const { LOW_PERCENT, RESET_PERCENT } = require('../utils/battery');
const rslService = require('./rslService');

/**
 * Notification worker.
 *
 * Normal RSL alerts are driven by the same M1 result as the dashboard. The M1
 * LOWER bound is the conservative operational boundary. No mock countdown,
 * interval midpoint, upper bound, or fabricated spoilage time is used.
 *
 * The legacy `buildMessage` kinds are retained for backward-compatible message
 * formatting tests; the scheduler uses `mulai`, `rsl_watch`, `rsl_low`,
 * `offline`, and the existing battery path only.
 */

const NEW_SESSION_WINDOW_MS = 6 * 3600 * 1000;
const DISCLAIMER =
  'Envelope historis M1; bukan interval kepercayaan, bukan jaminan keamanan, dan bukan waktu kedaluwarsa yang pasti.';

const fmt = (n, d = 1) => (n === null || n === undefined ? '-' : Number(n).toFixed(d).replace('.', ','));

function formatRemaining(sec) {
  // Legacy formatter retained for compatibility tests. The RSL scheduler does
  // not call this for normal alerts.
  const h = Math.floor(Math.max(0, sec || 0) / 3600);
  return h < 1 ? 'kurang dari 1 jam' : `±${h} jam`;
}

function formatHours(hours) {
  return `${fmt(hours, 1)} jam`;
}

/** Susun isi pesan WhatsApp. */
function buildMessage({
  kind,
  chamberName,
  sesiCode,
  sisaDetik = null,
  reading = null,
  zones = { segarHours: 24, rawanHours: 8 },
  status = null,
  lowerHours = null,
  upperHours = null,
  thresholdHours = null,
}) {
  const sensor = reading
    ? `Suhu ${fmt(reading.suhu)} °C · Kelembapan ${fmt(reading.rh)} % · TVOC ${fmt(reading.tvoc, 0)} ppb`
    : null;
  const lines = { mulai: [], segeraJual: [], tidakLayak: [], rslWatch: [], rslLow: [], offline: [] };
  lines.mulai = [
    `🟢 *Tahu baru masuk* ke *${chamberName}* (ID sesi ${sesiCode}).`,
    'Data sensor pertama sudah diterima sistem.',
    sensor,
    sisaDetik === null || sisaDetik === undefined
      ? 'Estimasi RSL akan muncul setelah operator mengisi status sampel.'
      : `Perkiraan sisa umur tahu ${formatRemaining(sisaDetik)}${status ? ` (${status})` : ''}.`,
  ];
  // Legacy message shapes, retained for existing message-format tests.
  lines.segeraJual = [
    `⚠️ *${chamberName}* (ID sesi ${sesiCode}) sekarang *Segera Konsumsi*.`,
    `Perkiraan sisa umur tahu ${formatRemaining(sisaDetik)} (di bawah ${zones.segarHours} jam).`,
    sensor,
    'Saran: konsumsi atau olah tahu di chamber ini secepatnya.',
  ];
  lines.tidakLayak = [
    `⛔ *${chamberName}* (ID sesi ${sesiCode}) sekarang *Tidak Layak Konsumsi*.`,
    `Perkiraan sisa umur tahu ${formatRemaining(sisaDetik)} (di bawah ${zones.rawanHours} jam).`,
    sensor,
    'Saran: periksa kondisi tahu sebelum dikonsumsi.',
  ];
  lines.rslWatch = [
    `⚠️ *${chamberName}* (ID sesi ${sesiCode}) — sisa historis mulai terbatas.`,
    `Batas bawah M1: *${formatHours(lowerHours)}* · rentang ${formatHours(lowerHours)}–${formatHours(upperHours)}.`,
    `Ambang peringatan: batas bawah ≤ ${formatHours(thresholdHours)}.`,
    DISCLAIMER,
    sensor,
  ];
  lines.rslLow = [
    `⛔ *${chamberName}* (ID sesi ${sesiCode}) — batas bawah historis mendekati.`,
    `Batas bawah M1: *${formatHours(lowerHours)}* · rentang ${formatHours(lowerHours)}–${formatHours(upperHours)}.`,
    `Ambang kritis: batas bawah ≤ ${formatHours(thresholdHours)}.`,
    DISCLAIMER,
    sensor,
  ];
  lines.offline = [
    `📡 *${chamberName}* (ID sesi ${sesiCode}) *terputus*.`,
    'Sensor tidak mengirim data. Periksa daya dan koneksi Wi-Fi perangkat.',
  ];
  return ['*TOSCHA · Tofu Smart Chamber*', ...lines[kind].filter(Boolean)].join('\n');
}

function buildRslNotification({
  kind,
  chamberName,
  sesiCode,
  thresholdHours,
  lowerHours,
  upperHours,
}) {
  const level = kind === 'rsl_low' ? 'danger' : 'warning';
  const title =
    kind === 'rsl_low'
      ? `${chamberName} — batas bawah historis ≤ ${formatHours(thresholdHours)}`
      : `${chamberName} — sisa historis mulai terbatas`;
  const message =
    `Sesi ${sesiCode}: batas bawah M1 ${formatHours(lowerHours)}, ` +
    `rentang ${formatHours(lowerHours)}–${formatHours(upperHours)}. ` +
    `Ambang ${formatHours(thresholdHours)}.`;
  return { level, title, message, disclaimer: DISCLAIMER };
}

/** Tandai kejadian sesi secara atomik; true bila kita yang pertama menandai. */
async function claim(SessionModel, sessionId, field) {
  const now = new Date();
  const doc = await SessionModel.findOneAndUpdate(
    { _id: sessionId, status: 'aktif', [`notified.${field}`]: null },
    { $set: { [`notified.${field}`]: now } },
    { new: true }
  );
  return Boolean(doc);
}

async function release(SessionModel, sessionId, field) {
  await SessionModel.updateOne({ _id: sessionId }, { $set: { [`notified.${field}`]: null } });
}

/** Alasan WhatsApp tidak bisa dikirim (null = siap). */
function blockReason(recipients, configured = isConfigured()) {
  if (!configured) return 'token Fonnte belum diisi (FONNTE_TOKEN di backend/.env)';
  if (!recipients.length) return 'belum ada nomor WhatsApp tujuan (Pengaturan > Notifikasi)';
  return null;
}

let lastBlock;

async function createNotificationEvent(NotificationModel, identity, payload) {
  let event = await NotificationModel.findOne(identity);
  if (event) return { event, created: false };
  try {
    event = await NotificationModel.create({ ...identity, ...payload });
    return { event, created: true };
  } catch (err) {
    if (err.code !== 11000) throw err;
    event = await NotificationModel.findOne(identity);
    return { event, created: false };
  }
}

async function markDelivery(NotificationModel, eventId, deliveryStatus, error = null) {
  await NotificationModel.updateOne(
    { _id: eventId },
    {
      $set: {
        deliveryStatus,
        sentAt: deliveryStatus === 'sent' ? new Date() : null,
        error: error ? String(error).slice(0, 500) : null,
      },
    }
  );
}

async function checkOnce(now = Date.now(), deps = {}) {
  const models = deps.models || {
    Experiment,
    Chamber,
    Session,
    SensorReading,
    NotificationEvent,
  };
  const settings = deps.settings || (await SystemSetting.get());
  const estimator = deps.rslEstimator || rslService;
  const sender = deps.sendWhatsApp || sendWhatsApp;
  const configured = deps.isConfigured ? deps.isConfigured() : isConfigured();
  const recipients = settings.notifications?.whatsapp?.recipients || [];
  const reason = blockReason(recipients, configured);
  if (reason !== lastBlock) {
    if (reason) console.warn(`[wa] notifikasi otomatis TIDAK terkirim: ${reason}`);
    else if (lastBlock !== undefined) console.log('[wa] notifikasi otomatis siap dikirim');
    lastBlock = reason;
  }
  const waReady = !reason;
  let sent = 0;
  let eventsCreated = 0;

  if (waReady && !deps.skipBattery) {
    sent += await checkBattery(settings, recipients, now, {
      ChamberModel: models.Chamber,
      SettingModel: models.SystemSetting || SystemSetting,
      sender,
    });
  }

  const experiment = await models.Experiment.findOne({ status: 'aktif' }).lean();
  if (!experiment) return { sent, eventsCreated, reason: reason || null };

  const sessions = await models.Session.find({
    experimentId: experiment._id,
    status: 'aktif',
  }).lean();
  const chambers = new Map((await models.Chamber.find().lean()).map((c) => [c.chamberId, c]));

  for (const s of sessions) {
    const c = chambers.get(s.chamberId);
    const chamberName = c ? c.name : `Chamber ${s.chamberId}`;
    const createdAt = new Date(s.createdAt || s.masuk || 0).getTime();

    // "Tahu baru masuk" is a lifecycle notice, not a countdown. It never uses
    // the mock prediction and does not claim a remaining time.
    if (waReady && !s.notified?.mulai && s.masuk && now - createdAt < NEW_SESSION_WINDOW_MS) {
      if (await claim(models.Session, s._id, 'mulai')) {
        const reading = await models.SensorReading.findOne({ chamberId: s.chamberId })
          .sort({ timestamp: -1 })
          .lean();
        const message = buildMessage({
          kind: 'mulai',
          chamberName,
          sesiCode: s.sesiCode,
          reading,
          sisaDetik: null,
          status: null,
        });
        try {
          await sender(recipients, message);
          sent += 1;
          console.log(`[wa] terkirim: mulai ${s.sesiCode}`);
        } catch (err) {
          console.error(`[wa] gagal mengirim mulai ${s.sesiCode}: ${err.message}`);
          await release(models.Session, s._id, 'mulai');
        }
      }
    }

    let rsl;
    try {
      rsl = await estimator.estimateForSession({ experiment, session: s, now });
    } catch (err) {
      // Engine failure must never become a mock fallback notification. Keep
      // going so connectivity alerts still work.
      console.error(`[wa] RSL gagal untuk ${s.sesiCode}: ${err.message}`);
      rsl = null;
    }

    const connected = c ? isConnected(c, settings, now) : false;
    if (c && c.enabled && !connected && !s.notified?.offline && s.masuk && waReady) {
      if (await claim(models.Session, s._id, 'offline')) {
        const message = buildMessage({ kind: 'offline', chamberName, sesiCode: s.sesiCode });
        try {
          await sender(recipients, message);
          sent += 1;
          console.log(`[wa] terkirim: offline ${s.sesiCode}`);
        } catch (err) {
          console.error(`[wa] gagal mengirim offline ${s.sesiCode}: ${err.message}`);
          await release(models.Session, s._id, 'offline');
        }
      }
    }
    if (connected && s.notified?.offline) await release(models.Session, s._id, 'offline');

    if (
      !rsl ||
      rsl.status !== 'AVAILABLE' ||
      !rsl.primary ||
      rsl.sampleStatus !== 'NOT_SPOILED' ||
      rsl.storageCondition !== 'DRY'
    ) {
      continue;
    }

    const lowerHours = Number(rsl.primary.lowerHours);
    const upperHours = Number(rsl.primary.upperHours);
    if (!Number.isFinite(lowerHours) || !Number.isFinite(upperHours)) continue;

    const zones = settings.zones || { segarHours: 24, rawanHours: 8 };
    let kind = null;
    let thresholdHours = null;
    if (lowerHours <= zones.rawanHours && settings.notifications?.onTidakLayak !== false) {
      kind = 'rsl_low';
      thresholdHours = zones.rawanHours;
    } else if (lowerHours <= zones.segarHours && settings.notifications?.onSegeraJual !== false) {
      kind = 'rsl_watch';
      thresholdHours = zones.segarHours;
    }
    if (!kind) continue;

    const identity = {
      experimentId: experiment._id,
      sessionId: s._id,
      chamberId: s.chamberId,
      kind,
      thresholdHours,
    };
    const content = buildRslNotification({
      kind,
      chamberName,
      sesiCode: s.sesiCode,
      thresholdHours,
      lowerHours,
      upperHours,
    });
    const { event, created } = await createNotificationEvent(models.NotificationEvent, identity, {
      ...content,
      lowerHours,
      upperHours,
      deliveryStatus: 'in_app',
    });
    if (!created || !event) continue;
    eventsCreated += 1;

    if (!waReady) continue;
    const reading = await models.SensorReading.findOne({ chamberId: s.chamberId })
      .sort({ timestamp: -1 })
      .lean();
    const message = buildMessage({
      kind: kind === 'rsl_low' ? 'rslLow' : 'rslWatch',
      chamberName,
      sesiCode: s.sesiCode,
      reading,
      lowerHours,
      upperHours,
      thresholdHours,
    });
    try {
      await sender(recipients, message);
      sent += 1;
      await markDelivery(models.NotificationEvent, event._id, 'sent');
      console.log(`[wa] terkirim: ${kind} ${s.sesiCode}`);
    } catch (err) {
      console.error(`[wa] gagal mengirim ${kind} ${s.sesiCode}: ${err.message}`);
      await markDelivery(models.NotificationEvent, event._id, 'failed', err.message);
    }

  }

  return { sent, eventsCreated, reason: reason || null };
}

/** Peringatan baterai lemah: sekali saja, lalu boleh lagi setelah baterai diisi melewati RESET_PERCENT. */
async function checkBattery(
  settings,
  recipients,
  now = Date.now(),
  { ChamberModel = Chamber, SettingModel = SystemSetting, sender = sendWhatsApp } = {}
) {
  const c = await ChamberModel.findOne({ battery: { $ne: null } }).sort({ batteryAt: -1 }).lean();
  if (!c || !isConnected({ lastSeenAt: c.batteryAt }, settings, now)) return 0;
  if (c.battery >= RESET_PERCENT && settings.batteryLowNotifiedAt) {
    await SettingModel.updateOne({ key: 'default' }, { $set: { batteryLowNotifiedAt: null } });
    return 0;
  }
  if (c.battery >= LOW_PERCENT) return 0;
  const claimed = await SettingModel.findOneAndUpdate(
    { key: 'default', batteryLowNotifiedAt: null },
    { $set: { batteryLowNotifiedAt: new Date() } },
    { new: true }
  );
  if (!claimed) return 0;
  const message = [
    '*TOSCHA · Tofu Smart Chamber*',
    `🔋 *Baterai alat lemah*: tinggal *${c.battery}%*.`,
    'Segera isi daya agar sensor tetap mengirim data.',
  ].join('\n');
  try {
    await sender(recipients, message);
    console.log(`[wa] terkirim: baterai lemah ${c.battery}%`);
    return 1;
  } catch (err) {
    console.error(`[wa] gagal mengirim baterai lemah: ${err.message}`);
    await SettingModel.updateOne({ key: 'default' }, { $set: { batteryLowNotifiedAt: null } });
    return 0;
  }
}

let timer = null;
let running = false;

function start() {
  if (timer) return;
  const every = Math.max(15, env.whatsapp.checkIntervalSec) * 1000;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await checkOnce();
    } catch (err) {
      console.error(`[wa] pemeriksaan gagal: ${err.message}`);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, every);
  setTimeout(tick, 5000);
  console.log(`[wa] pemeriksa notifikasi WhatsApp aktif (tiap ${every / 1000} detik, ${env.whatsapp.dryRun ? 'mode uji' : env.whatsapp.fonnteToken ? 'Fonnte' : 'token belum diisi'})`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, checkOnce, buildMessage, buildRslNotification, formatRemaining };
