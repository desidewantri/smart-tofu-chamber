/**
 * Phase 10 local E2E: final RSL snapshots + persisted M1 notifications.
 *
 * Local-only. Refuses any database other than smart_tofu_chamber_e2e.
 */
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const mqtt = require('mqtt');

const Experiment = require('../src/models/Experiment');
const Session = require('../src/models/Session');
const SensorReading = require('../src/models/SensorReading');
const Prediction = require('../src/models/Prediction');
const Chamber = require('../src/models/Chamber');
const User = require('../src/models/User');
const RslSnapshot = require('../src/models/RslSnapshot');
const NotificationEvent = require('../src/models/NotificationEvent');
const SystemSetting = require('../src/models/SystemSetting');
const ImportCursor = require('../src/models/ImportCursor');
const ImportReceipt = require('../src/models/ImportReceipt');
const rslService = require('../src/services/rslService');
const notifierService = require('../src/services/notifierService');

const API = (process.env.API_URL || 'http://127.0.0.1:5099').replace(/\/$/, '');
const MQTT_URL = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
const DB_NAME = 'smart_tofu_chamber_e2e';
const nowId = () => `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

async function api(pathname, { method = 'GET', token = null, body = null } = {}) {
  const res = await fetch(`${API}/api${pathname}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

async function waitFor(fn, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('E2E wait timeout');
}

function publish(topic, payload) {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(MQTT_URL, {
      clientId: `e2e10-pub-${nowId()}`,
      reconnectPeriod: 0,
      connectTimeout: 5000,
    });
    const timer = setTimeout(() => { client.end(true); reject(new Error('MQTT publish timeout')); }, 8000);
    client.on('connect', () => {
      client.publish(topic, JSON.stringify(payload), { qos: 0 }, (err) => {
        clearTimeout(timer);
        if (err) { client.end(true); reject(err); return; }
        setTimeout(() => client.end(false, {}, () => resolve()), 400);
      });
    });
    client.on('error', (err) => { clearTimeout(timer); client.end(true); reject(err); });
  });
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  assert.equal(mongoose.connection.name, DB_NAME, 'E2E must use the dedicated database');
  await Promise.all([
    Experiment.init(), Session.init(), SensorReading.init(), Prediction.init(),
    Chamber.init(), User.init(), RslSnapshot.init(), NotificationEvent.init(),
    ImportCursor.init(), ImportReceipt.init(),
  ]);
  await Promise.all([
    Experiment.deleteMany({}), Session.deleteMany({}), SensorReading.deleteMany({}),
    Prediction.deleteMany({}), Chamber.deleteMany({}), User.deleteMany({}),
    RslSnapshot.deleteMany({}), NotificationEvent.deleteMany({}),
    ImportCursor.deleteMany({}), ImportReceipt.deleteMany({}),
  ]);

  const settings = await SystemSetting.get();
  settings.notifications.whatsapp.recipients = ['6281234567890'];
  await settings.save();

  const summary = { database: DB_NAME, checks: {} };
  const email = `e2e10-${nowId()}@local.test`;
  const password = 'E2eLocal123!';
  let auth = await api('/auth/register', { method: 'POST', body: { name: 'E2E Phase 10', email, password } });
  if (auth.status !== 201) auth = await api('/auth/login', { method: 'POST', body: { email, password } });
  assert.ok(auth.json?.data?.token, 'auth token');
  const token = auth.json.data.token;
  summary.checks.auth = true;

  const started = await api('/experiments', {
    method: 'POST', token,
    body: { label: 'E2E Phase 10 snapshot', storageCondition: 'DRY' },
  });
  assert.equal(started.status, 201, started.text);
  const experiment = started.json.data.experiment;
  const sessions = started.json.data.sessions;
  const s1 = sessions.find((s) => s.chamberId === 1);
  const s2 = sessions.find((s) => s.chamberId === 2);
  assert.equal(sessions.length, 2);
  summary.experimentId = experiment.id;
  summary.chamber1SessionId = s1.id;
  summary.chamber2SessionId = s2.id;
  summary.checks.startExperiment = true;

  for (const s of sessions) {
    const r = await api(`/experiments/${experiment.id}/sessions/${s.id}/sample-status`, {
      method: 'PATCH', token, body: { sampleStatus: 'NOT_SPOILED', storageCondition: 'DRY' },
    });
    assert.equal(r.status, 200, r.text);
  }
  summary.checks.operatorStatus = true;

  const sample = `e2e10-${nowId()}-1`;
  const sampledAt = new Date().toISOString();
  await publish('smartchamber/sensor/1', {
    event_id: `${sample}-ch1`, sample_id: sample, device_id: 'tofusense-E2E',
    chamber_id: 1, tvoc: 89, suhu: 30.59, rh: 66.45, sampled_at: sampledAt, timestamp: sampledAt,
  });
  await publish('smartchamber/sensor/2', {
    event_id: `${sample}-ch2`, sample_id: sample, device_id: 'tofusense-E2E',
    chamber_id: 2, tvoc: 110, suhu: 30.43, rh: 65.64, sampled_at: sampledAt, timestamp: sampledAt,
  });
  await waitFor(async () => (await SensorReading.countDocuments({ sampleId: sample })) === 2);
  summary.sampleId = sample;
  summary.checks.mqttPersistence = true;

  // The same 20-hour window used by the dashboard/browser fixture.
  await Experiment.updateOne({ _id: experiment.id }, { $set: { startedAt: new Date(Date.now() - 20 * 3600000) } });

  const sent = [];
  const notifierDeps = {
    models: { Experiment, Session, Chamber, SensorReading, NotificationEvent },
    settings,
    rslEstimator: rslService,
    sendWhatsApp: async (recipients, message) => { sent.push({ recipients, message }); },
    isConfigured: () => true,
    skipBattery: true,
  };
  const firstCheck = await notifierService.checkOnce(Date.now(), notifierDeps);
  assert.equal(firstCheck.eventsCreated, 2, JSON.stringify(firstCheck));
  assert.equal(await NotificationEvent.countDocuments({}), 2);
  assert.ok(sent.some((m) => /batas bawah M1/i.test(m.message)));
  const firstEvents = await NotificationEvent.find({}).lean();
  assert.deepEqual(firstEvents.map((e) => e.kind).sort(), ['rsl_low', 'rsl_low']);
  for (const event of firstEvents) {
    assert.equal(event.thresholdHours, 8);
    assert.ok(event.lowerHours < 8);
    assert.equal(event.deliveryStatus, 'sent');
  }
  summary.checks.notificationCreated = true;

  const secondCheck = await notifierService.checkOnce(Date.now(), notifierDeps);
  assert.equal(secondCheck.eventsCreated, 0);
  assert.equal(await NotificationEvent.countDocuments({}), 2);
  assert.equal(sent.filter((m) => /batas bawah M1/i.test(m.message)).length, 2);
  summary.checks.notificationIdempotent = true;

  const notes = await api('/notifications', { token });
  assert.equal(notes.status, 200);
  const rslNotes = notes.json.data.filter((n) => n.kind === 'rsl_low');
  assert.equal(rslNotes.length, 2);
  assert.ok(rslNotes[0].disclaimer);
  summary.checks.notificationApi = true;

  const stopped = await api(`/experiments/${experiment.id}/stop`, { method: 'POST', token });
  assert.equal(stopped.status, 200, stopped.text);
  const stopData = stopped.json.data;
  assert.equal(stopData.snapshots.length, 2, JSON.stringify(stopData.snapshotErrors));
  assert.equal(stopData.snapshotErrors.length, 0);
  const endedAt = new Date(stopData.experiment.endedAt).getTime();
  for (const snap of stopData.snapshots) {
    assert.equal(new Date(snap.snapshotAt).getTime(), endedAt);
    assert.equal(snap.status, 'AVAILABLE');
    assert.ok(snap.primary.lowerHours > 3 && snap.primary.lowerHours < 3.2);
    assert.ok(snap.primary.upperHours > 22.8 && snap.primary.upperHours < 23);
    assert.deepEqual(snap.primary.display, { lowerHours: 3, upperHours: 23 });
    assert.equal(snap.metadata.referencePopulation, 3);
  }
  summary.snapshotAt = new Date(endedAt).toISOString();
  summary.snapshotLower = stopData.snapshots[0].primary.lowerHours;
  summary.snapshotUpper = stopData.snapshots[0].primary.upperHours;
  summary.checks.snapshotsCreated = true;

  const detail = await api(`/experiments/${experiment.id}`, { token });
  assert.equal(detail.json.data.snapshots.length, 2);
  const sessionDetail = await api(`/sesi/${s1.id}`, { token });
  assert.equal(sessionDetail.json.data.rslSnapshot.chamberId, 1);
  assert.equal(sessionDetail.json.data.rslSnapshot.status, 'AVAILABLE');
  summary.checks.snapshotHistoryApi = true;

  const snapshotCount = await RslSnapshot.countDocuments({});
  const stoppedAgain = await api(`/experiments/${experiment.id}/stop`, { method: 'POST', token });
  assert.equal(stoppedAgain.json.data.alreadyStopped, true);
  assert.equal(await RslSnapshot.countDocuments({}), snapshotCount);
  assert.equal(stoppedAgain.json.data.snapshots.length, 2);
  summary.checks.stopIdempotent = true;

  const afterStopCheck = await notifierService.checkOnce(Date.now(), notifierDeps);
  assert.equal(afterStopCheck.eventsCreated, 0);
  summary.checks.closedExperimentNoNotifications = true;

  // A second experiment demonstrates unavailable snapshot persistence.
  const secondStart = await api('/experiments', {
    method: 'POST', token,
    body: { label: 'E2E Phase 10 unavailable snapshot', storageCondition: 'DRY' },
  });
  assert.equal(secondStart.status, 201, secondStart.text);
  const secondExp = secondStart.json.data.experiment;
  const secondSessions = secondStart.json.data.sessions;
  const second1 = secondSessions.find((s) => s.chamberId === 1);
  const second2 = secondSessions.find((s) => s.chamberId === 2);
  await api(`/experiments/${secondExp.id}/sessions/${second1.id}/sample-status`, {
    method: 'PATCH', token, body: { sampleStatus: 'UNKNOWN' },
  });
  await api(`/experiments/${secondExp.id}/sessions/${second2.id}/sample-status`, {
    method: 'PATCH', token, body: { sampleStatus: 'SPOILED' },
  });
  const secondStop = await api(`/experiments/${secondExp.id}/stop`, { method: 'POST', token });
  assert.equal(secondStop.status, 200, secondStop.text);
  assert.equal(secondStop.json.data.snapshots.length, 2);
  const byChamber = Object.fromEntries(secondStop.json.data.snapshots.map((s) => [s.chamberId, s]));
  assert.equal(byChamber[1].status, 'UNAVAILABLE');
  assert.equal(byChamber[1].reason, 'SAMPLE_STATUS_UNKNOWN');
  assert.equal(byChamber[1].primary, null);
  assert.equal(byChamber[2].status, 'UNAVAILABLE');
  assert.equal(byChamber[2].reason, 'SAMPLE_REPORTED_SPOILED');
  assert.equal(byChamber[2].primary, null);
  summary.checks.unavailableSnapshots = true;

  summary.final = {
    snapshots: await RslSnapshot.countDocuments({}),
    notificationEvents: await NotificationEvent.countDocuments({}),
    firstExperimentStatus: (await Experiment.findById(experiment.id).lean()).status,
    secondExperimentStatus: (await Experiment.findById(secondExp.id).lean()).status,
  };
  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
