const env = require('../config/env');
const Chamber = require('../models/Chamber');
const Session = require('../models/Session');
const SensorReading = require('../models/SensorReading');
const SystemSetting = require('../models/SystemSetting');
const { STATUS, classifyShelfLife, remainingSeconds } = require('../utils/status');
const { isConnected } = require('../utils/presenters');
const { sendWhatsApp, isConfigured } = require('./whatsappService');
const { LOW_PERCENT, RESET_PERCENT } = require('../utils/battery');
const { latestBattery } = require('./batteryService');

/**
 * Pemeriksa berkala: kirim WhatsApp saat
 *  - tahu baru masuk (sesi baru, data sensor & prediksi pertama sudah diterima),
 *  - status sesi BERUBAH menjadi Segera Konsumsi / Tidak Layak Konsumsi,
 *  - chamber terputus, atau baterai alat lemah.
 * Notifikasi SELALU aktif (tidak ada saklar di aplikasi). Syaratnya hanya: token Fonnte terisi
 * dan minimal satu nomor tujuan. Setiap kejadian dikirim sekali per sesi (ditandai di session.notified).
 */

/** Sesi yang dibuat lebih lama dari ini tidak dikirimi pesan "tahu baru masuk" (mis. sesi lama saat fitur ini dipasang). */
const NEW_SESSION_WINDOW_MS = 6 * 3600 * 1000;

const fmt = (n, d = 1) => (n === null || n === undefined ? '-' : Number(n).toFixed(d).replace('.', ','));

function formatRemaining(sec) {
  // Jam saja, dibulatkan ke bawah: prediksi tidak setepat menit.
  const h = Math.floor(Math.max(0, sec || 0) / 3600);
  return h < 1 ? 'kurang dari 1 jam' : `±${h} jam`;
}

/** Susun isi pesan. kind: 'mulai' | 'segeraJual' | 'tidakLayak' | 'offline' */
function buildMessage({ kind, chamberName, sesiCode, sisaDetik, reading, zones, status }) {
  const sensor = reading
    ? `Suhu ${fmt(reading.suhu)} °C · Kelembapan ${fmt(reading.rh)} % · TVOC ${fmt(reading.tvoc, 0)} ppb`
    : null;
  const lines = { mulai: [], segeraJual: [], tidakLayak: [], offline: [] };
  lines.mulai = [
    `🟢 *Tahu baru masuk* ke *${chamberName}* (ID sesi ${sesiCode}).`,
    'Data sensor pertama sudah diterima sistem.',
    sensor,
    `Perkiraan sisa umur tahu ${formatRemaining(sisaDetik)}${status ? ` (${status})` : ''}.`,
  ];
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

/** Alasan notifikasi tidak bisa dikirim (null = siap). Dicatat di log sekali setiap kali berubah. */
let lastBlock;
function blockReason(recipients) {
  if (!isConfigured()) return 'token Fonnte belum diisi (FONNTE_TOKEN di backend/.env)';
  if (!recipients.length) return 'belum ada nomor WhatsApp tujuan (Pengaturan > Notifikasi)';
  return null;
}

async function checkOnce(now = Date.now()) {
  const settings = await SystemSetting.get();
  const recipients = settings.notifications?.whatsapp?.recipients || [];
  const reason = blockReason(recipients);
  if (reason !== lastBlock) {
    if (reason) console.warn(`[wa] notifikasi otomatis TIDAK terkirim: ${reason}`);
    else if (lastBlock !== undefined) console.log('[wa] notifikasi otomatis siap dikirim');
    lastBlock = reason;
  }
  if (reason) return { sent: 0, reason };
  const wa = { recipients };
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

    // Tahu baru masuk: sesi baru yang sudah punya data & prediksi pertama.
    const createdAt = new Date(s.createdAt || s.masuk || 0).getTime();
    if (!s.notified?.mulai && s.prediksiDibuat && now - createdAt < NEW_SESSION_WINDOW_MS) jobs.push('mulai');

    if (status === STATUS.TIDAK && !s.notified?.tidakLayak) jobs.push('tidakLayak');
    else if (status === STATUS.SEGERA && !s.notified?.segeraJual) jobs.push('segeraJual');

    const connected = c ? isConnected(c, settings, now) : false;
    if (c && c.enabled && !connected && !s.notified?.offline) jobs.push('offline');
    // Tersambung lagi -> boleh kirim peringatan "terputus" lagi bila nanti putus kembali.
    if (connected && s.notified?.offline) await release(s._id, 'offline');

    for (const kind of jobs) {
      if (!(await claim(s._id, kind))) continue;
      // Sudah Tidak Layak Konsumsi -> pesan Segera Konsumsi tidak perlu dikirim lagi.
      if (kind === 'tidakLayak') await Session.updateOne({ _id: s._id, 'notified.segeraJual': null }, { $set: { 'notified.segeraJual': new Date() } });
      const reading = await SensorReading.findOne({ chamberId: s.chamberId }).sort({ timestamp: -1 }).lean();
      const message = buildMessage({ kind, chamberName, sesiCode: s.sesiCode, sisaDetik: sisa, reading, zones: settings.zones, status });
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

/**
 * Peringatan baterai lemah: sekali saja, lalu boleh lagi setelah baterai diisi melewati RESET_PERCENT.
 * Memakai baterai dari data sensor terakhir; kosong ("–") atau data lama tidak memicu pesan.
 */
async function checkBattery(settings, recipients, now = Date.now()) {
  const b = await latestBattery(settings, now);
  if (b.percent === null || b.stale) return 0;
  const c = { battery: b.percent };
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
