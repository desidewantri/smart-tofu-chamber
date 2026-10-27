const env = require('../config/env');
const Chamber = require('../models/Chamber');
const Session = require('../models/Session');
const SensorReading = require('../models/SensorReading');
const SystemSetting = require('../models/SystemSetting');
const { STATUS, classifyShelfLife, remainingSeconds } = require('../utils/status');
const { isConnected } = require('../utils/presenters');
const { sendWhatsApp, isConfigured } = require('./whatsappService');
const { LOW_PERCENT, RESET_PERCENT } = require('../utils/battery');

/**
 * Pemeriksa berkala: kirim WhatsApp saat status sesi BERUBAH menjadi
 * Segera Konsumsi / Tidak Layak Konsumsi, atau saat chamber terputus.
 * Setiap kejadian hanya dikirim sekali per sesi (ditandai di session.notified).
 */

const fmt = (n, d = 1) => (n === null || n === undefined ? '-' : Number(n).toFixed(d).replace('.', ','));

function formatRemaining(sec) {
  // Jam saja, dibulatkan ke bawah: prediksi tidak setepat menit.
  const h = Math.floor(Math.max(0, sec || 0) / 3600);
  return h < 1 ? 'kurang dari 1 jam' : `±${h} jam`;
}

/** Susun isi pesan. kind: 'segeraJual' | 'tidakLayak' | 'offline' */
function buildMessage({ kind, chamberName, sesiCode, sisaDetik, reading, zones }) {
  const sensor = reading
    ? `Suhu ${fmt(reading.suhu)} °C · Kelembapan ${fmt(reading.rh)} % · TVOC ${fmt(reading.tvoc, 0)} ppb`
    : null;
  const lines = { segeraJual: [], tidakLayak: [], offline: [] };
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
  lines.offline = [
    `📡 *${chamberName}* (ID sesi ${sesiCode}) *terputus*.`,
    'Sensor tidak mengirim data. Periksa daya dan koneksi Wi-Fi perangkat.',
  ];
  return ['*TOSCHA · Tofu Smart Chamber*', ...lines[kind].filter(Boolean)].join('\n');
}

/** Tandai kejadian secara atomik; true bila kita yang pertama menandai (berhak mengirim). */
async function claim(sessionId, field) {
  const now = new Date();
  const doc = await Session.findOneAndUpdate(
    { _id: sessionId, status: 'aktif', [`notified.${field}`]: null },
    { $set: { [`notified.${field}`]: now } },
    { new: true }
  );
  return Boolean(doc);
}

async function release(sessionId, field) {
  await Session.updateOne({ _id: sessionId }, { $set: { [`notified.${field}`]: null } });
}

async function checkOnce(now = Date.now()) {
  const settings = await SystemSetting.get();
  const n = settings.notifications || {};
  const wa = n.whatsapp || {};
  if (!n.enabled || !wa.enabled || !(wa.recipients || []).length || !isConfigured()) return { sent: 0 };
  let sent = 0;

  sent += await checkBattery(settings, wa.recipients, now);

  const sessions = await Session.find({ status: 'aktif' }).lean();
  const chambers = new Map((await Chamber.find().lean()).map((c) => [c.chamberId, c]));

  for (const s of sessions) {
    const c = chambers.get(s.chamberId);
    const chamberName = c ? c.name : `Chamber ${s.chamberId}`;
    const sisa = remainingSeconds(s, now);
    const status = sisa === null ? null : classifyShelfLife(sisa / 3600, settings.zones);
    const jobs = [];

    if (status === STATUS.TIDAK && n.onTidakLayak && !s.notified?.tidakLayak) jobs.push('tidakLayak');
    else if (status === STATUS.SEGERA && n.onSegeraJual && !s.notified?.segeraJual) jobs.push('segeraJual');

    const connected = c ? isConnected(c, settings, now) : false;
    if (c && c.enabled && !connected && n.onOffline && !s.notified?.offline) jobs.push('offline');
    // Tersambung lagi -> boleh kirim peringatan "terputus" lagi bila nanti putus kembali.
    if (connected && s.notified?.offline) await release(s._id, 'offline');

    for (const kind of jobs) {
      if (!(await claim(s._id, kind))) continue;
      // Sudah Tidak Layak Konsumsi -> pesan Segera Konsumsi tidak perlu dikirim lagi.
      if (kind === 'tidakLayak') await Session.updateOne({ _id: s._id, 'notified.segeraJual': null }, { $set: { 'notified.segeraJual': new Date() } });
      const reading = await SensorReading.findOne({ chamberId: s.chamberId }).sort({ timestamp: -1 }).lean();
      const message = buildMessage({ kind, chamberName, sesiCode: s.sesiCode, sisaDetik: sisa, reading, zones: settings.zones });
      try {
        await sendWhatsApp(wa.recipients, message);
        sent += 1;
        console.log(`[wa] terkirim: ${kind} ${s.sesiCode}`);
      } catch (err) {
        console.error(`[wa] gagal mengirim ${kind} ${s.sesiCode}: ${err.message}`);
        await release(s._id, kind); // coba lagi pada pemeriksaan berikutnya
      }
    }
  }
  return { sent };
}

/** Peringatan baterai lemah: sekali saja, lalu boleh lagi setelah baterai diisi melewati RESET_PERCENT. */
async function checkBattery(settings, recipients, now = Date.now()) {
  if (!settings.notifications?.onLowBattery) return 0;
  const c = await Chamber.findOne({ battery: { $ne: null } }).sort({ batteryAt: -1 }).lean();
  if (!c || !isConnected({ lastSeenAt: c.batteryAt }, settings, now)) return 0;
  if (c.battery >= RESET_PERCENT && settings.batteryLowNotifiedAt) {
    await SystemSetting.updateOne({ key: 'default' }, { $set: { batteryLowNotifiedAt: null } });
    return 0;
  }
  if (c.battery >= LOW_PERCENT) return 0;
  const claimed = await SystemSetting.findOneAndUpdate(
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
    await sendWhatsApp(recipients, message);
    console.log(`[wa] terkirim: baterai lemah ${c.battery}%`);
    return 1;
  } catch (err) {
    console.error(`[wa] gagal mengirim baterai lemah: ${err.message}`);
    await SystemSetting.updateOne({ key: 'default' }, { $set: { batteryLowNotifiedAt: null } });
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

module.exports = { start, stop, checkOnce, buildMessage, formatRemaining };
