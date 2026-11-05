#!/usr/bin/env node
/**
 * Cek koneksi ke broker MQTT yang dikonfigurasi di backend/.env tanpa
 * menampilkan kredensial.
 *
 *   npm run mqtt:check
 *
 * Exit 0 = connected + subscribe sukses. Exit 1 = gagal (dengan petunjuk).
 */
require('dotenv').config();

const mqtt = require('mqtt');
const env = require('../src/config/env');

function redact(url) {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
    }
    return parsed.toString();
  } catch {
    return 'invalid-url';
  }
}

const target = redact(env.mqtt.url);
console.log(`[check] broker   : ${target}`);
console.log(`[check] topic    : ${env.mqtt.topic}`);
console.log(`[check] clientId : ${env.mqtt.clientId}`);
console.log(`[check] username : ${env.mqtt.username ? 'set' : 'not set'}`);
console.log(`[check] password : ${env.mqtt.password ? 'set' : 'not set'}`);

if (!env.mqtt.enabled) {
  console.error('[check] MQTT_ENABLED=false di backend/.env');
  process.exit(1);
}

let settled = false;
const finish = (code, message) => {
  if (settled) return;
  settled = true;
  if (message) (code === 0 ? console.log : console.error)(message);
  client.end(true, () => process.exit(code));
};

const client = mqtt.connect(env.mqtt.url, {
  username: env.mqtt.username,
  password: env.mqtt.password,
  clientId: `toscha-check-${Date.now()}`,
  clean: true,
  reconnectPeriod: 0,
  connectTimeout: 5000,
});

client.on('connect', () => {
  console.log('[check] CONNECT ok');
  client.subscribe(env.mqtt.topic, { qos: 1 }, (err, granted) => {
    if (err) return finish(1, `[check] SUBSCRIBE gagal: ${err.message}`);
    const topics = (granted || []).map((g) => g.topic).join(', ');
    finish(0, `[check] SUBSCRIBE ok: ${topics}`);
  });
});

client.on('error', (err) => {
  finish(1, `[check] ERROR: ${err.message}`);
});

setTimeout(() => {
  finish(1,
    '[check] timeout. Periksa: broker berjalan? host/port benar? kredensial cocok ' +
    'dengan deploy/mosquitto-passwd? firewall port 1883 terbuka?');
}, 7000);
