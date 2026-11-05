const mqtt = require('mqtt');
const env = require('../config/env');
const { ingestReading } = require('./ingestService');

let client = null;

/** Sembunyikan kredensial yang mungkin tertanam di URL sebelum ditampilkan/di-log. */
function redactUrl(url) {
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

/**
 * Terima satu pesan MQTT: parse JSON, ambil chamber dari payload atau akhiran
 * topik, lalu serahkan ke jalur ingest kanonik (validasi + dedup + prediksi).
 * Diekspor terpisah agar bisa diuji tanpa broker.
 */
async function handleMessage(topic, buffer, deps = null) {
  const payload = JSON.parse(buffer.toString());
  const match = /(\d+)$/.exec(String(topic));
  return ingestReading(
    payload,
    { topicChamberId: match ? Number(match[1]) : undefined, source: 'mqtt' },
    deps
  );
}

/**
 * Subscribe ke topik sensor dan teruskan tiap pesan ke alur ingest.
 * `config` dan `deps` opsional hanya untuk pengujian; produksi memakai env dan
 * model Mongoose asli.
 */
function start({ config = env.mqtt, deps = null, connect = mqtt.connect } = {}) {
  if (!config.enabled) {
    console.log('[mqtt] dinonaktifkan (MQTT_ENABLED=false)');
    return null;
  }

  client = connect(config.url, {
    username: config.username,
    password: config.password,
    clientId: config.clientId,
    clean: false, // sesi persisten: broker menyimpan pesan selama backend mati
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    console.log(`[mqtt] terhubung ke ${redactUrl(config.url)}`);
    client.subscribe(config.topic, { qos: 1 }, (err) => {
      if (err) console.error('[mqtt] gagal subscribe:', err.message);
      else console.log(`[mqtt] subscribe ${config.topic}`);
    });
  });

  client.on('message', (topic, buffer) => {
    handleMessage(topic, buffer, deps)
      .then(({ session, prediction, duplicate }) => {
        console.log(
          `[mqtt] ${topic} -> ${session ? session.sesiCode : 'tanpa sesi'}` +
            (duplicate ? ' | duplikat, diabaikan' : '') +
            (prediction ? ` | ${prediction.shelfLifeJam} jam (${prediction.modelUsed})` : ' | tanpa prediksi')
        );
      })
      .catch((err) => {
        // Payload rusak / nilai tidak valid tidak boleh mematikan subscriber.
        console.error(`[mqtt] pesan dari ${topic} ditolak: ${err.message}`);
      });
  });

  client.on('reconnect', () => console.log('[mqtt] mencoba terhubung ulang...'));
  client.on('error', (err) => console.error('[mqtt] error:', err.message));
  return client;
}

function status() {
  return {
    enabled: env.mqtt.enabled,
    connected: Boolean(client && client.connected),
    url: redactUrl(env.mqtt.url),
  };
}

function stop() {
  return new Promise((resolve) => {
    if (!client) return resolve();
    const current = client;
    client = null;
    current.end(false, {}, () => resolve());
  });
}

module.exports = { start, stop, status, handleMessage, redactUrl };
