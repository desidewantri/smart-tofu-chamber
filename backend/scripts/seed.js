/**
 * Mengisi database dengan data DEMO: user, 4 chamber, ~60 sesi riwayat, dan 2 sesi aktif.
 * Jalankan: npm run seed   (menghapus data lama di database ini!)
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const User = require('../src/models/User');
const Chamber = require('../src/models/Chamber');
const Session = require('../src/models/Session');
const SensorReading = require('../src/models/SensorReading');
const Prediction = require('../src/models/Prediction');
const SystemSetting = require('../src/models/SystemSetting');
const { classifyShelfLife } = require('../src/utils/status');
const { mulberry32, gauss, buildSession, baseTslHours, round } = require('./lib/simulate');

const DAY = 24 * 3600 * 1000;

async function main() {
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 5000 });
  console.log(`[seed] terhubung: ${mongoose.connection.name}`);

  await Promise.all([
    User.deleteMany({}), Chamber.deleteMany({}), Session.deleteMany({}),
    SensorReading.deleteMany({}), Prediction.deleteMany({}), SystemSetting.deleteMany({}),
  ]);
  await Promise.all([Session.syncIndexes(), SensorReading.syncIndexes(), Prediction.syncIndexes()]);

  const settings = await SystemSetting.create({ key: 'default' });
  await User.create({ name: 'Admin', email: 'admin@tofu.local', password: 'admin123', role: 'admin' });

  const now = Date.now();
  await Chamber.insertMany([
    { chamberId: 1, code: 'CHAMBER-1', name: 'Chamber 1', enabled: true, lastSeenAt: new Date(now) },
    { chamberId: 2, code: 'CHAMBER-2', name: 'Chamber 2', enabled: true, lastSeenAt: new Date(now) },
  ]);

  const rnd = mulberry32(20260524);
  let seq = 0;
  const readingDocs = [];
  const predDocs = [];

  // ---------- Riwayat (sesi selesai) ----------
  const HISTORY = 60;
  const starts = Array.from({ length: HISTORY }, () => now - (2 + rnd() * 356) * DAY).sort((a, b) => a - b);

  for (let i = 0; i < HISTORY; i += 1) {
    const startMs = starts[i];
    const month = new Date(startMs).getUTCMonth() + 1;
    const rainy = [10, 11, 12, 1, 2, 3].includes(month);
    const tempC = (rainy ? 26 : 28) - rnd() * 9 + gauss(rnd) * 0.4; // ~17-28 °C
    const rhBase = (rainy ? 80 : 66) + gauss(rnd) * 2;
    const tsl = baseTslHours(tempC) * (0.92 + rnd() * 0.16);
    const exitFrac = 0.2 + rnd() * 0.8; // tahu diambil pada 20%-100% umur
    const age = Math.max(1, tsl * exitFrac);
    const chamberId = (i % 2) + 1; // Chamber 1 atau 2
    seq += 1;

    const sim = buildSession({
      rnd, chamberId, start: new Date(startMs), ageHours: age, stepMinutes: 30, tempC, rhBase, tsl,
    });
    const first = sim.readings[0];
    const lastPred = sim.predictions[sim.predictions.length - 1];
    const sisaAkhir = Math.max(0, tsl - age);

    const session = await Session.create({
      seq, sesiCode: Session.codeFor(seq), chamberId, status: 'selesai',
      masuk: new Date(startMs), selesai: new Date(startMs + age * 3600000),
      tvoc_awal: first.tvoc, suhu_awal: first.suhu, rh_awal: first.rh,
      shelfLifeMulai: sim.predictions[0].shelfLifeJam,
      shelfLifeAwal: lastPred.shelfLifeJam, prediksiDibuat: lastPred.prediksiDibuat,
      modelUsed: lastPred.modelUsed, readingCount: sim.readings.length,
      statusAkhir: classifyShelfLife(sisaAkhir, settings.zones), sisaAkhirJam: round(sisaAkhir, 2),
    });
    sim.readings.forEach((r) => readingDocs.push({ ...r, sesiId: session._id, createdAt: r.timestamp }));
    sim.predictions.forEach((p) => predDocs.push({ ...p, sesiId: session._id, createdAt: p.prediksiDibuat }));
  }

  // ---------- Sesi aktif (meniru contoh di desain Figma) ----------
  const live = [
    { chamberId: 1, tempC: 19.7, rhBase: 77, tsl: 26.0, age: 19.35 }, // sisa ~6j39m -> Tidak Layak Konsumsi
    { chamberId: 2, tempC: 20.2, rhBase: 72, tsl: 24.0, age: 10.35 }, // sisa ~13j39m -> Segera Konsumsi
  ];
  for (const l of live) {
    seq += 1;
    const startMs = now - l.age * 3600000;
    const sim = buildSession({
      rnd, chamberId: l.chamberId, start: new Date(startMs), ageHours: l.age,
      stepMinutes: 5, tempC: l.tempC, rhBase: l.rhBase, tsl: l.tsl,
    });
    // geser stempel waktu agar pembacaan terakhir = sekarang
    const shift = now - sim.readings[sim.readings.length - 1].timestamp.getTime();
    sim.readings.forEach((r) => { r.timestamp = new Date(r.timestamp.getTime() + shift); });
    sim.predictions.forEach((p) => { p.prediksiDibuat = new Date(p.prediksiDibuat.getTime() + shift); });

    const first = sim.readings[0];
    const lastPred = sim.predictions[sim.predictions.length - 1];
    const session = await Session.create({
      seq, sesiCode: Session.codeFor(seq), chamberId: l.chamberId, status: 'aktif',
      masuk: new Date(startMs + shift),
      tvoc_awal: first.tvoc, suhu_awal: first.suhu, rh_awal: first.rh,
      shelfLifeMulai: sim.predictions[0].shelfLifeJam,
      shelfLifeAwal: lastPred.shelfLifeJam, prediksiDibuat: lastPred.prediksiDibuat,
      modelUsed: lastPred.modelUsed, readingCount: sim.readings.length,
    });
    sim.readings.forEach((r) => readingDocs.push({ ...r, sesiId: session._id, createdAt: r.timestamp }));
    sim.predictions.forEach((p) => predDocs.push({ ...p, sesiId: session._id, createdAt: p.prediksiDibuat }));
  }

  await SensorReading.insertMany(readingDocs, { ordered: false });
  await Prediction.insertMany(predDocs, { ordered: false });

  console.log(`[seed] selesai: ${seq} sesi, ${readingDocs.length} pembacaan, ${predDocs.length} prediksi`);
  console.log('[seed] login demo -> email: admin@tofu.local | password: admin123');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[seed] gagal:', err.message);
  try { await mongoose.disconnect(); } catch (_) { /* abaikan */ }
  process.exit(1);
});
