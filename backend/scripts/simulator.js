/**
 * Simulator sensor: meniru ESP32 yang mengirim data TVOC/suhu/RH.
 * Berguna untuk mencoba seluruh alur tanpa hardware.
 *
 *   npm run simulate -- --chamber 3                (kirim via HTTP POST /api/sensor)
 *   npm run simulate -- --chamber 3 --mqtt         (kirim via MQTT, butuh Mosquitto)
 *
 * Opsi: --chamber N  --interval DETIK (jeda kirim, default 3)  --step MENIT (waktu simulasi per kirim, default 5)
 *       --temp C (default 27)  --rh % (default 70)  --age JAM (umur awal tahu, default 0)
 *       --battery % (baterai awal, default 100)
 *       --count N (berhenti setelah N kiriman)  --api URL  --key API_KEY  --mqtt-url URL
 */
const { mulberry32, gauss, tvocAt, baseTslHours, round } = require('./lib/simulate');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const chamberId = Number(args.chamber || 1);
const intervalSec = Number(args.interval || 3);
const stepMin = Number(args.step || 5);
const tempC = Number(args.temp || 27);
const rhBase = Number(args.rh || 70);
let ageH = Number(args.age || 0);
const maxCount = args.count ? Number(args.count) : Infinity;
const api = (args.api || process.env.API_URL || 'http://localhost:5000').replace(/\/$/, '');
const apiKey = args.key || process.env.DEVICE_API_KEY || 'dev-device-key';
const useMqtt = Boolean(args.mqtt);
const mqttUrl = args['mqtt-url'] || process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';

const rnd = mulberry32(Date.now() % 100000);
const tsl = baseTslHours(tempC);
let sent = 0;
let mqttClient = null;
const batteryStart = Number(args.battery ?? 100);
const ageStart = ageH;

function nextPayload() {
  const payload = {
    chamber_id: chamberId,
    tvoc: round(Math.max(20, tvocAt(ageH, tsl) + gauss(rnd) * 12), 1),
    suhu: round(tempC + gauss(rnd) * 0.25, 2),
    rh: round(Math.min(99, Math.max(30, rhBase + gauss(rnd) * 1.2)), 1),
    // Baterai alat: habis dalam ±48 jam waktu simulasi.
    battery: Math.max(0, Math.round(batteryStart - (ageH - ageStart) * (100 / 48))),
    timestamp: new Date().toISOString(),
  };
  ageH += stepMin / 60;
  return payload;
}

async function sendHttp(payload) {
  const res = await fetch(`${api}/api/sensor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.message || 'gagal'}`);
  const p = body.data?.prediction;
  return `${body.data?.session?.sesiCode}${p ? ` | prediksi ${p.shelfLifeJam} jam (${p.modelUsed})` : ''}`;
}

function sendMqtt(payload) {
  return new Promise((resolve, reject) => {
    mqttClient.publish(`smartchamber/sensor/${chamberId}`, JSON.stringify(payload), { qos: 1 }, (err) =>
      err ? reject(err) : resolve('dipublikasikan'));
  });
}

async function tick() {
  const payload = nextPayload();
  try {
    const info = useMqtt ? await sendMqtt(payload) : await sendHttp(payload);
    sent += 1;
    console.log(
      `#${sent} ch${chamberId} umur ${ageH.toFixed(2)} j | TVOC ${payload.tvoc} ppb, ${payload.suhu}°C, ${payload.rh}% -> ${info}`
    );
  } catch (err) {
    console.error(`kirim gagal: ${err.message}`);
  }
  if (sent >= maxCount) {
    console.log('selesai.');
    if (mqttClient) mqttClient.end();
    process.exit(0);
  }
}

function run() {
  console.log(`Simulator chamber ${chamberId} via ${useMqtt ? `MQTT ${mqttUrl}` : `HTTP ${api}`}, kirim tiap ${intervalSec} detik (Ctrl+C untuk berhenti)`);
  tick();
  setInterval(tick, intervalSec * 1000);
}

if (useMqtt) {
  mqttClient = require('mqtt').connect(mqttUrl);
  mqttClient.on('connect', run);
  mqttClient.on('error', (e) => console.error('mqtt error:', e.message));
} else {
  run();
}
