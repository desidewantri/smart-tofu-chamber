/**
 * Phase 10.1 local E2E: snapshot completeness, crash recovery, partial writes,
 * original-endedAt preservation, and input protection.
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
const recovery = require('../src/services/rslSnapshotService');

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
      clientId: `e2e101-pub-${nowId()}`,
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

async function startAndPublish(token, label) {
  const started = await api('/experiments', {
    method: 'POST', token,
    body: { label, storageCondition: 'DRY' },
  });
  assert.equal(started.status, 201, started.text);
  const experiment = started.json.data.experiment;
  const sessions = started.json.data.sessions;
  for (const s of sessions) {
    const r = await api(`/experiments/${experiment.id}/sessions/${s.id}/sample-status`, {
      method: 'PATCH', token, body: { sampleStatus: 'NOT_SPOILED', storageCondition: 'DRY' },
    });
    assert.equal(r.status, 200, r.text);
  }
  const sample = `e2e101-${nowId()}-1`;
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
  await Experiment.updateOne(
    { _id: experiment.id },
    { $set: { startedAt: new Date(Date.now() - 20 * 3600000) } }
  );
  return { experiment, sessions, sample };
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
  const summary = { database: DB_NAME, checks: {} };
  const email = `e2e101-${nowId()}@local.test`;
  const password = 'E2eLocal123!';
  let auth = await api('/auth/register', { method: 'POST', body: { name: 'E2E Phase 10.1', email, password } });
  if (auth.status !== 201) auth = await api('/auth/login', { method: 'POST', body: { email, password } });
  assert.ok(auth.json?.data?.token, 'auth token');
  const token = auth.json.data.token;
  summary.checks.auth = true;

  // 1. Normal stop.
  const normal = await startAndPublish(token, 'Phase 10.1 normal stop');
  const normalStop = await api(`/experiments/${normal.experiment.id}/stop`, { method: 'POST', token });
  assert.equal(normalStop.status, 200, normalStop.text);
  assert.equal(normalStop.json.data.snapshots.length, 2);
  assert.equal(normalStop.json.data.experiment.rslSnapshotStatus, 'COMPLETE');
  assert.equal(normalStop.json.data.experiment.rslSnapshotCompletedCount, 2);
  const normalEnded = new Date(normalStop.json.data.experiment.endedAt).getTime();
  for (const snap of normalStop.json.data.snapshots) {
    assert.equal(new Date(snap.snapshotAt).getTime(), normalEnded);
    assert.equal(snap.status, 'AVAILABLE');
    assert.ok(snap.primary.lowerHours > 3 && snap.primary.lowerHours < 3.2);
  }
  summary.normalExperimentId = normal.experiment.id;
  summary.normalSnapshotAt = new Date(normalEnded).toISOString();
  summary.checks.normalStopComplete = true;

  // 2. Simulated crash after experiment closure, before snapshot persistence.
  const crashed = await startAndPublish(token, 'Phase 10.1 crash recovery');
  const crashEnded = new Date();
  await Experiment.updateOne(
    { _id: crashed.experiment.id },
    {
      $set: {
        status: 'selesai',
        endedAt: crashEnded,
        rslSnapshotStatus: 'PENDING',
        rslSnapshotExpectedCount: 2,
        rslSnapshotCompletedCount: 0,
        rslSnapshotLeaseUntil: null,
        rslSnapshotLeaseOwner: null,
        rslSnapshotNextAttemptAt: null,
      },
    }
  );
  // Deliberately leave sessions active: the worker must close them using the
  // original endedAt, not reopen or leave an active orphan.
  const recoverySummary = await recovery.runOnce({
    now: Date.now(),
    deps: { models: { Experiment, Session, RslSnapshot, SensorReading }, settings, rslEstimator: rslService },
  });
  assert.ok(recoverySummary.experimentsCompleted >= 1, JSON.stringify(recoverySummary));
  const crashExp = await Experiment.findById(crashed.experiment.id).lean();
  const crashSnaps = await RslSnapshot.find({ experimentId: crashed.experiment.id }).lean();
  const crashSessions = await Session.find({ experimentId: crashed.experiment.id }).lean();
  assert.equal(crashExp.rslSnapshotStatus, 'COMPLETE');
  assert.equal(crashExp.rslSnapshotCompletedCount, 2);
  assert.equal(new Date(crashExp.endedAt).getTime(), crashEnded.getTime());
  assert.equal(crashSnaps.length, 2);
  for (const snap of crashSnaps) {
    assert.equal(new Date(snap.snapshotAt).getTime(), crashEnded.getTime());
    assert.equal(snap.status, 'AVAILABLE');
  }
  for (const s of crashSessions) {
    assert.equal(s.status, 'selesai');
    assert.equal(new Date(s.selesai).getTime(), crashEnded.getTime());
  }
  summary.crashedExperimentId = crashed.experiment.id;
  summary.checks.crashRecoveryComplete = true;

  // 3. One existing snapshot, one missing: recovery fills only the missing one.
  const partial = await startAndPublish(token, 'Phase 10.1 partial recovery');
  const partialStop = await api(`/experiments/${partial.experiment.id}/stop`, { method: 'POST', token });
  assert.equal(partialStop.status, 200, partialStop.text);
  const partialEnded = new Date(partialStop.json.data.experiment.endedAt).getTime();
  const chamber1Before = await RslSnapshot.findOne({ experimentId: partial.experiment.id, chamberId: 1 }).lean();
  await RslSnapshot.deleteOne({ experimentId: partial.experiment.id, chamberId: 2 });
  await Experiment.updateOne(
    { _id: partial.experiment.id },
    {
      $set: {
        rslSnapshotStatus: 'PENDING',
        rslSnapshotCompletedCount: 1,
        rslSnapshotLeaseUntil: null,
        rslSnapshotLeaseOwner: null,
        rslSnapshotNextAttemptAt: null,
      },
    }
  );
  const partialRecovery = await recovery.runOnce({
    now: Date.now(),
    deps: { models: { Experiment, Session, RslSnapshot, SensorReading }, settings, rslEstimator: rslService },
  });
  assert.ok(partialRecovery.experimentsCompleted >= 1, JSON.stringify(partialRecovery));
  const chamber1After = await RslSnapshot.findOne({ experimentId: partial.experiment.id, chamberId: 1 }).lean();
  const partialSnaps = await RslSnapshot.find({ experimentId: partial.experiment.id }).lean();
  assert.equal(partialSnaps.length, 2);
  assert.equal(chamber1After.primary.lowerHours, chamber1Before.primary.lowerHours);
  assert.equal(chamber1After.snapshotAt.toISOString(), chamber1Before.snapshotAt.toISOString());
  assert.equal(new Date(chamber1After.snapshotAt).getTime(), partialEnded);
  summary.checks.partialRecoveryPreservesExisting = true;

  // 4. Both snapshots exist but completion state is PENDING.
  const stateOnly = await startAndPublish(token, 'Phase 10.1 completion state recovery');
  const stateStop = await api(`/experiments/${stateOnly.experiment.id}/stop`, { method: 'POST', token });
  assert.equal(stateStop.status, 200, stateStop.text);
  const stateEnded = new Date(stateStop.json.data.experiment.endedAt).getTime();
  await Experiment.updateOne(
    { _id: stateOnly.experiment.id },
    { $set: { rslSnapshotStatus: 'PENDING', rslSnapshotCompletedCount: 0, rslSnapshotLeaseUntil: null, rslSnapshotNextAttemptAt: null } }
  );
  const beforeStateSnaps = await RslSnapshot.countDocuments({ experimentId: stateOnly.experiment.id });
  const stateRecovery = await recovery.runOnce({
    now: Date.now(),
    deps: { models: { Experiment, Session, RslSnapshot, SensorReading }, settings, rslEstimator: rslService },
  });
  assert.ok(stateRecovery.experimentsCompleted >= 1, JSON.stringify(stateRecovery));
  const stateExp = await Experiment.findById(stateOnly.experiment.id).lean();
  const afterStateSnaps = await RslSnapshot.countDocuments({ experimentId: stateOnly.experiment.id });
  assert.equal(stateExp.rslSnapshotStatus, 'COMPLETE');
  assert.equal(beforeStateSnaps, 2);
  assert.equal(afterStateSnaps, 2);
  assert.equal(new Date(stateExp.endedAt).getTime(), stateEnded);
  summary.checks.completionStateRecovery = true;

  // 5. Historical API exposes completeness.
  const detail = await api(`/experiments/${crashed.experiment.id}`, { token });
  assert.equal(detail.json.data.experiment.rslSnapshotStatus, 'COMPLETE');
  assert.equal(detail.json.data.snapshots.length, 2);
  summary.checks.historicalApiComplete = true;

  // 6. Closed session sample status is immutable through the normal API.
  const statusAttempt = await api(
    `/experiments/${normal.experiment.id}/sessions/${normal.sessions[0].id}/sample-status`,
    { method: 'PATCH', token, body: { sampleStatus: 'SPOILED' } }
  );
  assert.equal(statusAttempt.status, 409, statusAttempt.text);
  summary.checks.closedSessionStatusProtected = true;

  // 7. Late MQTT cannot attach to a closed experiment.
  const beforeLate = await SensorReading.countDocuments({});
  const lateSample = `e2e101-late-${nowId()}`;
  await publish('smartchamber/sensor/1', {
    event_id: `${lateSample}-ch1`, sample_id: lateSample, device_id: 'tofusense-E2E',
    chamber_id: 1, tvoc: 90, suhu: 30, rh: 66, sampled_at: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(await SensorReading.countDocuments({}), beforeLate);
  summary.checks.lateMqttRejected = true;

  summary.final = {
    experiments: await Experiment.countDocuments({}),
    snapshots: await RslSnapshot.countDocuments({}),
    complete: await Experiment.countDocuments({ rslSnapshotStatus: 'COMPLETE' }),
    pending: await Experiment.countDocuments({ rslSnapshotStatus: 'PENDING' }),
    active: await Experiment.countDocuments({ status: 'aktif' }),
  };
  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
