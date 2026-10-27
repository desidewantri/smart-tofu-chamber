require('dotenv').config();

const bool = (v, d) => (v === undefined || v === '' ? d : String(v).toLowerCase() === 'true');

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
  ml: {
    mode: (process.env.ML_MODE || 'mock').toLowerCase(), // mock | live | auto
    url: (process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, ''),
    timeoutMs: Number(process.env.ML_TIMEOUT_MS) || 3000,
  },
};
