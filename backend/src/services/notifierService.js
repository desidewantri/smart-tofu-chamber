const env = require('../config/env');
const Chamber = require('../models/Chamber');
const Session = require('../models/Session');
const SensorReading = require('../models/SensorReading');
const SystemSetting = require('../models/SystemSetting');
const { STATUS, classifyShelfLife, remainingSeconds } = require('../utils/status');
const { isConnected } = require('../utils/presenters');
const { sendWhatsApp, isConfigured } = require('./whatsappService');

/**
 * Pemeriksa berkala: kirim WhatsApp saat status sesi BERUBAH menjadi
 * Segera Jual / Tidak Layak Jual, atau saat chamber terputus.
 * Setiap kejadian hanya dikirim sekali per sesi (ditandai di session.notified).
 */

const fmt = (n, d = 1) => (n === null || n === undefined ? '-' : Number(n).toFixed(d).replace('.', ','));

function formatRemaining(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h} jam ${m} menit`;
}

/** Susun isi pesan. kind: 'segeraJual' | 'tidakLayak' | 'offline' */
function buildMessage({ kind, chamberName, sesiCode, sisaDetik, reading, zones }) {
  const sensor = reading
    ? `Suhu ${fmt(reading.suhu)} °C · Kelembapan ${fmt(reading.rh)} % · TVOC ${fmt(reading.tvoc, 0)} ppb`
    : null;
  const lines = { segeraJual: [], tidakLayak: [], offline: [] };
  lines.segeraJual = [
    `⚠️ *${chamberName}* (ID sesi ${sesiCode}) sekarang *Segera Jual*.`,
    `Sisa umur tahu ±${formatRemaining(sisaDetik)} (di bawah ${zones.segarHours} jam).`,
    sensor,
    'Saran: jual atau olah tahu di chamber ini secepatnya.',
  ];
  lines.tidakLayak = [
    `⛔ *${chamberName}* (ID sesi ${sesiCode}) sekarang *Tidak Layak Jual*.`,
    `Sisa umur tahu ±${formatRemaining(sisaDetik)} (di bawah ${zones.rawanHours} jam).`,
    sensor,
    'Saran: periksa kondisi tahu sebelum dijual.',
  ];
  lines.offline = [
    `📡 *${chamberName}* (ID sesi ${sesiCode}) *terputus*.`,
    'Sensor tidak mengirim data. Periksa daya dan koneksi Wi-Fi perangkat.',
  ];
  return ['*Smart Tofu Chamber*', ...lines[kind].filter(Boolean)].join('\n');
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

  const sessions = await Session.find({ status: 'aktif' }).lean();
  const chambers = new Map((await Chamber.find().lean()).map((c) => [c.chamberId, c]));
  let sent = 0;

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
      // Sudah Tidak Layak Jual -> pesan Segera Jual tidak perlu dikirim lagi.
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
