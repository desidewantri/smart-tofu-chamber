const env = require('../config/env');
const ApiError = require('../utils/ApiError');

/**
 * Pengirim WhatsApp. Saat ini lewat gateway Fonnte (https://fonnte.com).
 * Kode lain hanya memanggil sendWhatsApp(), jadi penyedia bisa diganti
 * (mis. WhatsApp Cloud API resmi) cukup di file ini.
 */

/** "0812-3456 7890" / "+62 812..." / "62812..." -> "62812..." ; null bila tidak valid. */
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0')) d = `62${d.slice(1)}`;
  else if (d.startsWith('8')) d = `62${d}`;
  if (!/^62\d{8,13}$/.test(d)) return null;
  return d;
}

function isConfigured() {
  return env.whatsapp.dryRun || Boolean(env.whatsapp.fonnteToken);
}

async function sendViaFonnte(targets, message) {
  const body = new URLSearchParams({ target: targets.join(','), message, countryCode: '62' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await fetch(env.whatsapp.fonnteUrl, {
      method: 'POST',
      headers: { Authorization: env.whatsapp.fonnteToken },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    throw new ApiError(502, `Tidak dapat menghubungi Fonnte: ${err.name === 'AbortError' ? 'waktu habis' : err.message}`);
  } finally {
    clearTimeout(timer);
  }
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* respons bukan JSON */
  }
  if (!res.ok || json.status === false) {
    throw new ApiError(502, `Fonnte menolak pesan: ${json.reason || `HTTP ${res.status}`}`);
  }
  return { provider: 'fonnte', detail: json.detail || 'terkirim', id: json.id || null };
}

/**
 * Kirim satu pesan teks ke beberapa nomor.
 * @returns {Promise<{provider:string, detail:string, targets:string[]}>}
 */
async function sendWhatsApp(recipients, message) {
  const targets = [...new Set((recipients || []).map(normalizePhone).filter(Boolean))];
  if (!targets.length) throw new ApiError(400, 'Belum ada nomor WhatsApp tujuan yang valid');
  if (!message) throw new ApiError(400, 'Pesan kosong');

  if (env.whatsapp.dryRun) {
    console.log(`[wa] (WA_DRY_RUN) ke ${targets.join(', ')}:\n${message}\n`);
    return { provider: 'dry-run', detail: 'mode uji: pesan hanya dicetak di terminal', targets };
  }
  if (!env.whatsapp.fonnteToken) {
    throw new ApiError(400, 'Token Fonnte belum diisi. Isi FONNTE_TOKEN di backend/.env lalu jalankan ulang backend.');
  }
  if (env.whatsapp.provider !== 'fonnte') throw new ApiError(400, `Penyedia WhatsApp "${env.whatsapp.provider}" belum didukung`);
  const out = await sendViaFonnte(targets, message);
  return { ...out, targets };
}

module.exports = { sendWhatsApp, normalizePhone, isConfigured };
