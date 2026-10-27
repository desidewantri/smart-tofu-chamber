require('dotenv').config();

const bool = (v, d) => (v === undefined || v === '' ? d : String(v).toLowerCase() === 'true');

const nodeEnv = process.env.NODE_ENV || 'development';
if (nodeEnv === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || /ganti/.test(process.env.JWT_SECRET))) {
  // Tanpa ini, siapa pun yang tahu nilai bawaan bisa membuat token login palsu.
  console.error('[env] JWT_SECRET wajib diisi string acak minimal 32 karakter di server produksi.');
  process.exit(1);
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/smart_tofu_chamber',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-ganti-saat-deploy',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  deviceApiKey: process.env.DEVICE_API_KEY || '',
  mqtt: {
    enabled: bool(process.env.MQTT_ENABLED, true),
    url: process.env.MQTT_URL || 'mqtt://127.0.0.1:1883',
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    topic: process.env.MQTT_TOPIC || 'smartchamber/sensor/+',
  },
  auth: {
    // Izinkan siapa pun membuat akun lewat halaman Daftar (false = hanya admin yang bisa menambah akun)
    allowRegistration: bool(process.env.ALLOW_REGISTRATION, true),
    // Client ID OAuth dari Google Cloud Console. Kosong = tombol "Masuk dengan Google" disembunyikan.
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  },
  whatsapp: {
    provider: (process.env.WA_PROVIDER || 'fonnte').toLowerCase(),
    fonnteToken: process.env.FONNTE_TOKEN || '',
    fonnteUrl: process.env.FONNTE_URL || 'https://api.fonnte.com/send',
    // true = pesan hanya dicetak di terminal, tidak benar-benar dikirim (untuk uji tanpa token)
    dryRun: bool(process.env.WA_DRY_RUN, false),
    checkIntervalSec: Number(process.env.WA_CHECK_INTERVAL_SEC) || 60,
  },
  sheet: {
    // Link Google Sheet (dibagikan "Anyone with the link") atau link CSV hasil "Publish to web".
    // Kosong = fitur impor Sheet mati.
    url: process.env.SHEET_URL || '',
    pollSec: Math.max(15, Number(process.env.SHEET_POLL_SEC) || 60),
    tzOffset: process.env.SHEET_TZ_OFFSET || '+07:00', // waktu di Sheet = WIB
    dateOrder: (process.env.SHEET_DATE_ORDER || 'mdy').toLowerCase(), // mdy (10/22/2026) | dmy (22/10/2026)
    importSince: process.env.SHEET_IMPORT_SINCE || '', // opsional, mis. 2026-10-22T21:00:00+07:00
  },
  ml: {
    mode: (process.env.ML_MODE || 'mock').toLowerCase(), // mock | live | auto
    url: (process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, ''),
    timeoutMs: Number(process.env.ML_TIMEOUT_MS) || 3000,
  },
};
