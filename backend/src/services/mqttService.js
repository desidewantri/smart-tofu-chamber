const mqtt = require('mqtt');
const env = require('../config/env');
const { ingestReading } = require('./ingestService');

let client = null;

/** Subscribe ke smartchamber/sensor/+ dan teruskan tiap pesan ke alur ingest. */
function start() {
  if (!env.mqtt.enabled) {
    console.log('[mqtt] dinonaktifkan (MQTT_ENABLED=false)');
    return null;
  }

  client = mqtt.connect(env.mqtt.url, {
    username: env.mqtt.username,
    password: env.mqtt.password,
    clientId: `stc-backend-${process.pid}`,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    console.log(`[mqtt] terhubung ke ${env.mqtt.url}`);
    client.subscribe(env.mqtt.topic, { qos: 1 }, (err) => {
      if (err) console.error('[mqtt] gagal subscribe:', err.message);
      else console.log(`[mqtt] subscribe ${env.mqtt.topic}`);
    });
  });

  client.on('message', async (topic, buffer) => {
    try {
      const payload = JSON.parse(buffer.toString());
      const m = /(\d+)$/.exec(topic);
      const { session, prediction } = await ingestReading(payload, {
        topicChamberId: m ? Number(m[1]) : undefined,
      });
      console.log(
        `[mqtt] ${topic} -> ${session.sesiCode}` +
          (prediction ? ` | ${prediction.shelfLifeJam} jam (${prediction.modelUsed})` : ' | tanpa prediksi')
      );
    } catch (err) {
      console.error(`[mqtt] pesan dari ${topic} ditolak: ${err.message}`);
    }
  });

  client.on('reconnect', () => console.log('[mqtt] mencoba terhubung ulang...'));
  client.on('error', (err) => console.error('[mqtt] error:', err.message));
  return client;
}

function status() {
  return { enabled: env.mqtt.enabled, connected: Boolean(client && client.connected), url: env.mqtt.url };
}

function stop() {
  return new Promise((resolve) => {
    if (!client) return resolve();
    client.end(false, {}, () => resolve());
  });
}

module.exports = { start, stop, status };
