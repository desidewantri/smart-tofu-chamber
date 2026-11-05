/**
 * Phase 10.2 local E2E: session-closure reliability, finalization state,
 * late-MQTT rejection, and recovery after a partial closure failure.
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
const experimentService = require('../src/services/experimentService');
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
      clientId: `e2e102-pub-${nowId()}`,
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
  const sample = `e2e102-${nowId()}-1`;
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
  const email = `e2e102-${nowId()}@local.test`;
  const password = 'E2eLocal123!';
  let auth = await api('/auth/register', { method: 'POST', body: { name: 'E2E Phase 10.2', email, password } });
  if (auth.status !== 201) auth = await api('/auth/login', { method: 'POST', body: { email, password } });
  assert.ok(auth.json?.data?.token, 'auth token');
  const token = auth.json.data.token;
  summary.checks.auth = true;

  // A controlled normal stop establishes the healthy baseline.
  const normal = await startAndPublish(token, 'Phase 10.2 normal');
  const normalStop = await api(`/experiments/${normal.experiment.id}/stop`, { method: 'POST', token });
  assert.equal(normalStop.status, 200, normalStop.text);
  assert.equal(normalStop.json.data.experiment.finalizationStatus, 'COMPLETE');
  assert.equal(normalStop.json.data.experiment.finalizationClosedSessionCount, 2);
  assert.equal(normalStop.json.data.experiment.rslSnapshotStatus, 'COMPLETE');
  assert.equal(normalStop.json.data.snapshots.length, 2);
  summary.checks.normalFinalization = true;

  // Simulate Chamber 2 session-closure failure while snapshots still succeed.
  const failed = await startAndPublish(token, 'Phase 10.2 partial closure');
  const chamber2Id = failed.sessions.find((s) => s.chamberId === 2).id;
  const failingSessionModel = {
    find: Session.find.bind(Session),
    findOne: Session.findOne.bind(Session),
    findById: Session.findById.bind(Session),
    updateOne: Session.updateOne.bind(Session),
    findByIdAndUpdate: async (id, update, options) => {
      if (String(id) === String(chamber2Id)) {
        throw new Error('simulated Chamber 2 closure failure');
      }
      return Session.findByIdAndUpdate(id, update, options);
    },
  };
  const partial = await experimentService.stopExperiment(failed.experiment.id, {
    models: {
      Experiment,
      Session: failingSessionModel,
      RslSnapshot,
      SensorReading,
    },
    settings,
    rslEstimator: rslService,
  });
  assert.equal(partial.experiment.status, 'selesai');
  assert.equal(partial.experiment.rslSnapshotStatus, 'COMPLETE');
  assert.equal(partial.experiment.finalizationStatus, 'PENDING');
  assert.equal(partial.experiment.finalizationClosedSessionCount, 1);
  assert.equal(partial.snapshots.length, 2);
  assert.equal(partial.finalizationErrors.length >= 1, true);
  const session1 = await Session.findById(failed.sessions.find((s) => s.chamberId === 1).id).lean();
  const session2 = await Session.findById(chamber2Id).lean();
  assert.equal(session1.status, 'selesai');
  assert.equal(session2.status, 'aktif');
  assert.equal(new Date(session1.selesai).getTime(), new Date(partial.experiment.endedAt).getTime());
  summary.partialExperimentId = failed.experiment.id;
  summary.partialEndedAt = partial.experiment.endedAt;
  summary.checks.partialClosurePending = true;

  // Late MQTT must be rejected even though Chamber 2 is still active.
  const beforeLate = await SensorReading.countDocuments({});
  const lateSample = `e2e102-late-${nowId()}`;
  await publish('smartchamber/sensor/2', {
    event_id: `${lateSample}-ch2`, sample_id: lateSample, device_id: 'tofusense-E2E',
    chamber_id: 2, tvoc: 90, suhu: 30, rh: 66, sampled_at: new Date().toISOString(),
  });
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(await SensorReading.countDocuments({}), beforeLate);
  summary.checks.lateMqttRejectedWithOrphan = true;

  // Sample status must be rejected because the parent experiment is closed.
  const statusAttempt = await api(
    `/experiments/${failed.experiment.id}/sessions/${chamber2Id}/sample-status`,
    { method: 'PATCH', token, body: { sampleStatus: 'SPOILED' } }
  );
  assert.equal(statusAttempt.status, 409, statusAttempt.text);
  assert.equal(statusAttempt.json.details?.code, 'EXPERIMENT_CLOSED');
  summary.checks.closedParentStatusRejected = true;

  const closeAttempt = await api('/chambers/2/selesai', { method: 'POST', token });
  assert.equal(closeAttempt.status, 409, closeAttempt.text);
  assert.equal(closeAttempt.json.details?.code, 'EXPERIMENT_CLOSED');
  summary.checks.manualOrphanCloseRejected = true;

  // Recovery closes only the orphan using the original endedAt.
  const beforeSnaps = await RslSnapshot.find({ experimentId: failed.experiment.id }).lean();
  const recoveryNow = partial.experiment.finalizationNextAttemptAt
    ? new Date(partial.experiment.finalizationNextAttemptAt).getTime() + 1
    : Date.now();
  const recovered = await recovery.runOnce({
    now: recoveryNow,
    deps: {
      models: { Experiment, Session, RslSnapshot, SensorReading },
      settings,
      rslEstimator: rslService,
    },
  });
  assert.ok(recovered.experimentsFinalized >= 1, JSON.stringify(recovered));
  const recoveredExp = await Experiment.findById(failed.experiment.id).lean();
  const recoveredSession2 = await Session.findById(chamber2Id).lean();
  const afterSnaps = await RslSnapshot.find({ experimentId: failed.experiment.id }).lean();
  assert.equal(recoveredExp.finalizationStatus, 'COMPLETE');
  assert.equal(recoveredExp.finalizationClosedSessionCount, 2);
  assert.equal(recoveredExp.rslSnapshotStatus, 'COMPLETE');
  assert.equal(recoveredSession2.status, 'selesai');
  assert.equal(new Date(recoveredSession2.selesai).getTime(), new Date(recoveredExp.endedAt).getTime());
  assert.equal(afterSnaps.length, 2);
  assert.deepEqual(
    afterSnaps.map((s) => [s.chamberId, s.snapshotAt.toISOString(), s.primary?.lowerHours]),
    beforeSnaps.map((s) => [s.chamberId, s.snapshotAt.toISOString(), s.primary?.lowerHours])
  );
  summary.checks.recoveryClosedOrphanAndPreservedSnapshots = true;

  // A new experiment must ingest normally after the prior lifecycle completes.
  const next = await startAndPublish(token, 'Phase 10.2 next experiment');
  const nextReadings = await SensorReading.countDocuments({ sampleId: next.sample });
  assert.equal(nextReadings, 2);
  const nextStop = await api(`/experiments/${next.experiment.id}/stop`, { method: 'POST', token });
  assert.equal(nextStop.status, 200, nextStop.text);
  assert.equal(nextStop.json.data.experiment.finalizationStatus, 'COMPLETE');
  summary.checks.nextExperimentAccepted = true;

  const detail = await api(`/experiments/${failed.experiment.id}`, { token });
  assert.equal(detail.json.data.experiment.finalizationStatus, 'COMPLETE');
  assert.equal(detail.json.data.snapshots.length, 2);
  summary.checks.historicalApiFinalization = true;

  summary.final = {
    experiments: await Experiment.countDocuments({}),
    snapshots: await RslSnapshot.countDocuments({}),
    finalizationComplete: await Experiment.countDocuments({ finalizationStatus: 'COMPLETE' }),
    finalizationPending: await Experiment.countDocuments({ finalizationStatus: 'PENDING' }),
    activeExperiments: await Experiment.countDocuments({ status: 'aktif' }),
  };
  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
