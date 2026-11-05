/**
 * Phase 9 local end-to-end validation.
 *
 * Pipeline: HTTP experiment -> local MQTT Phase 7 payload -> Node ingest ->
 * MongoDB -> internal Python RSL service -> Node RSL API.
 *
 * Safety: refuses to run unless the database name is the dedicated local E2E
 * database. It never contacts production.
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const mongoose = require('mongoose');
const mqtt = require('mqtt');

const Experiment = require('../src/models/Experiment');
const Session = require('../src/models/Session');
const SensorReading = require('../src/models/SensorReading');
const Prediction = require('../src/models/Prediction');
const Chamber = require('../src/models/Chamber');
const ImportCursor = require('../src/models/ImportCursor');
const ImportReceipt = require('../src/models/ImportReceipt');
const User = require('../src/models/User');
const RslSnapshot = require('../src/models/RslSnapshot');
const NotificationEvent = require('../src/models/NotificationEvent');

const API = (process.env.API_URL || 'http://127.0.0.1:5099').replace(/\/$/, '');
const RSL_URL = (process.env.RSL_SERVICE_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
const MQTT_URL = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
const DB_NAME = 'smart_tofu_chamber_e2e';
const REPO = path.resolve(__dirname, '../..');

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
      clientId: `e2e9-pub-${nowId()}`,
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

function canonical(elapsedHours, sampleStatus, storageCondition = 'DRY') {
  const code = [
    'import json, sys',
    'from tofusense_rsl import estimate_rsl',
    `print(json.dumps(estimate_rsl(${JSON.stringify(elapsedHours)}, sample_status=${JSON.stringify(sampleStatus)}, storage_condition=${JSON.stringify(storageCondition)})))`,
  ].join('\n');
  const out = execFileSync('python3', ['-c', code], {
    cwd: REPO,
    env: { ...process.env, PYTHONPATH: path.join(REPO, 'rsl_engine/src') },
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

async function rslServiceEstimate(body) {
  const res = await fetch(`${RSL_URL}/estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  assert.equal(mongoose.connection.name, DB_NAME, 'E2E must use the dedicated database');
  await Promise.all([
    Experiment.init(), Session.init(), SensorReading.init(), Prediction.init(),
    ImportCursor.init(), ImportReceipt.init(), Chamber.init(), User.init(),
    RslSnapshot.init(), NotificationEvent.init(),
  ]);

  // Clear documents, never indexes or the database itself.
  await Promise.all([
    Experiment.deleteMany({}), Session.deleteMany({}), SensorReading.deleteMany({}),
    Prediction.deleteMany({}), ImportCursor.deleteMany({}), ImportReceipt.deleteMany({}),
    Chamber.deleteMany({}), User.deleteMany({}),
    RslSnapshot.deleteMany({}), NotificationEvent.deleteMany({}),
  ]);

  const summary = { database: DB_NAME, checks: {} };

  const email = `e2e9-${nowId()}@local.test`;
  const password = 'E2eLocal123!';
  let auth = await api('/auth/register', { method: 'POST', body: { name: 'E2E Phase 9', email, password } });
  if (auth.status !== 201) auth = await api('/auth/login', { method: 'POST', body: { email, password } });
  assert.ok(auth.json?.data?.token, 'auth token');
  const token = auth.json.data.token;
  summary.checks.auth = true;

  const started = await api('/experiments', {
    method: 'POST', token,
    body: { label: 'E2E Phase 9 RSL', storageCondition: 'DRY' },
  });
  assert.equal(started.status, 201, started.text);
  const experiment = started.json.data.experiment;
  const sessions = started.json.data.sessions;
  assert.equal(sessions.length, 2);
  assert.equal(experiment.storageCondition, 'DRY');
  for (const s of sessions) {
    assert.equal(s.experimentId, experiment.id);
    assert.equal(s.storageCondition, 'DRY');
    assert.equal(s.sampleStatus, 'UNKNOWN');
    assert.equal(s.masuk, null);
  }
  const s1 = sessions.find((s) => s.chamberId === 1);
  const s2 = sessions.find((s) => s.chamberId === 2);
  summary.experimentId = experiment.id;
  summary.startedAt = experiment.startedAt;
  summary.chamber1SessionId = s1.id;
  summary.chamber2SessionId = s2.id;
  summary.checks.startExperiment = true;
  summary.checks.twoLinkedSessions = true;
  summary.checks.sampleStatusUnset = true;

  const unknownRsl = await api(`/experiments/${experiment.id}/rsl/1`, { token });
  assert.equal(unknownRsl.status, 200);
  assert.equal(unknownRsl.json.data.status, 'UNAVAILABLE');
  assert.equal(unknownRsl.json.data.reason, 'SAMPLE_STATUS_UNKNOWN');
  assert.equal(unknownRsl.json.data.primary, null);
  summary.checks.unknownStatusNoEstimate = true;

  const set1 = await api(`/experiments/${experiment.id}/sessions/${s1.id}/sample-status`, {
    method: 'PATCH', token, body: { sampleStatus: 'NOT_SPOILED' },
  });
  assert.equal(set1.status, 200, set1.text);
  assert.equal(set1.json.data.session.sampleStatus, 'NOT_SPOILED');
  const set2 = await api(`/experiments/${experiment.id}/sessions/${s2.id}/sample-status`, {
    method: 'PATCH', token, body: { sampleStatus: 'SPOILED' },
  });
  assert.equal(set2.status, 200, set2.text);
  assert.equal(set2.json.data.session.sampleStatus, 'SPOILED');

  const stored1 = await Session.findById(s1.id).lean();
  const stored2 = await Session.findById(s2.id).lean();
  assert.equal(stored1.sampleStatus, 'NOT_SPOILED');
  assert.equal(stored2.sampleStatus, 'SPOILED');
  assert.ok(stored1.sampleStatusHistory.length >= 1);
  assert.ok(stored2.sampleStatusHistory.some((h) => h.status === 'SPOILED'));
  summary.checks.operatorStatusPersisted = true;

  const sample = `e2e9-${nowId()}-1`;
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
  const readings = await SensorReading.find({ sampleId: sample }).lean();
  const r1 = readings.find((r) => r.chamberId === 1);
  const r2 = readings.find((r) => r.chamberId === 2);
  assert.equal(String(r1.sesiId), s1.id);
  assert.equal(String(r2.sesiId), s2.id);
  assert.equal(r1.source, 'mqtt');
  assert.equal(r1.timestampQuality, 'OK');
  summary.sampleId = sample;
  summary.checks.mqttChamber1 = true;
  summary.checks.mqttChamber2 = true;
  summary.checks.mongodbPersistence = true;

  const rsl1 = await api(`/experiments/${experiment.id}/rsl/1`, { token });
  assert.equal(rsl1.status, 200, rsl1.text);
  const data1 = rsl1.json.data;
  assert.equal(data1.status, 'AVAILABLE', JSON.stringify(data1));
  assert.equal(data1.primary.method, 'M1');
  assert.equal(data1.primary.interpretation, 'EMPIRICAL_INTERVAL_ENVELOPE');
  assert.ok(data1.primary.lowerHours <= data1.primary.upperHours);
  assert.equal(data1.primary.display.lowerHours, Math.floor(data1.primary.lowerHours + 1e-12));
  assert.equal(data1.primary.display.upperHours, Math.ceil(data1.primary.upperHours - 1e-12));
  assert.ok(data1.supporting.M2);
  assert.ok(data1.supporting.M3);
  assert.equal(data1.metadata.tvocContribution, 'NOT_ESTABLISHED');
  assert.equal(data1.metadata.referencePopulation, 3);

  const direct1 = canonical(data1.elapsedHours, 'NOT_SPOILED', 'DRY');
  assert.equal(data1.primary.lowerHours, direct1.primary_rsl.lower_h);
  assert.equal(data1.primary.upperHours, direct1.primary_rsl.upper_h);
  assert.equal(data1.supporting.M2.components.length, direct1.methods.M2.components.length);
  for (let i = 0; i < direct1.methods.M2.components.length; i += 1) {
    assert.equal(data1.supporting.M2.components[i].lowerHours, direct1.methods.M2.components[i].lower_h);
    assert.equal(data1.supporting.M2.components[i].upperHours, direct1.methods.M2.components[i].upper_h);
    assert.equal(data1.supporting.M2.components[i].mass, direct1.methods.M2.components[i].mass);
  }
  if (direct1.methods.M3.available) {
    assert.equal(data1.supporting.M3.r10Hours, direct1.methods.M3.r10_h);
    assert.equal(data1.supporting.M3.r90Hours, direct1.methods.M3.r90_h);
  }
  summary.rslChamber1 = {
    elapsedHours: data1.elapsedHours,
    lowerHours: data1.primary.lowerHours,
    upperHours: data1.primary.upperHours,
    display: data1.primary.display,
    m2: data1.supporting.M2.components,
    m3: { r10: data1.supporting.M3.r10Hours, r90: data1.supporting.M3.r90Hours },
  };
  summary.checks.rslAvailable = true;
  summary.checks.canonicalParity = true;
  summary.checks.presentationRoundingSeparate = true;

  const rsl2 = await api(`/experiments/${experiment.id}/rsl/2`, { token });
  assert.equal(rsl2.json.data.status, 'UNAVAILABLE');
  assert.equal(rsl2.json.data.reason, 'SAMPLE_REPORTED_SPOILED');
  assert.equal(rsl2.json.data.primary, null);
  summary.checks.spoiledSuppressesEstimate = true;

  const analysis = await api(`/experiments/${experiment.id}/rsl/1/analysis`, { token });
  assert.equal(analysis.status, 200);
  assert.equal(analysis.json.data.supporting.M2.method, 'M2_TURNBULL_NPMLE');
  assert.equal(analysis.json.data.supporting.M3.method, 'M3_WEIBULL_A0');
  summary.checks.m2m3AnalysisApi = true;

  // Restore chamber 2 to a normal sample and verify both chambers can produce M1.
  await api(`/experiments/${experiment.id}/sessions/${s2.id}/sample-status`, {
    method: 'PATCH', token, body: { sampleStatus: 'NOT_SPOILED' },
  });
  const both = await Promise.all([
    api(`/experiments/${experiment.id}/rsl/1`, { token }),
    api(`/experiments/${experiment.id}/rsl/2`, { token }),
  ]);
  assert.equal(both[0].json.data.status, 'AVAILABLE');
  assert.equal(both[1].json.data.status, 'AVAILABLE');
  summary.checks.normalStatusBothChambers = true;

  // Elapsed time advances from the shared experiment start even without new readings.
  const beforeReadings = await SensorReading.countDocuments({ sesiId: s1.id });
  const beforeElapsed = both[0].json.data.elapsedHours;
  await Experiment.updateOne({ _id: experiment.id }, { $set: { startedAt: new Date(Date.now() - 20 * 3600000) } });
  const advanced = await api(`/experiments/${experiment.id}/rsl/1`, { token });
  assert.ok(advanced.json.data.elapsedHours >= beforeElapsed + 19.9);
  assert.equal(await SensorReading.countDocuments({ sesiId: s1.id }), beforeReadings);
  const directAdvanced = canonical(advanced.json.data.elapsedHours, 'NOT_SPOILED', 'DRY');
  assert.equal(advanced.json.data.primary.lowerHours, directAdvanced.primary_rsl.lower_h);
  assert.equal(advanced.json.data.primary.upperHours, directAdvanced.primary_rsl.upper_h);
  summary.rslChamber1Advanced = {
    elapsedHours: advanced.json.data.elapsedHours,
    lowerHours: advanced.json.data.primary.lowerHours,
    upperHours: advanced.json.data.primary.upperHours,
    display: advanced.json.data.primary.display,
  };
  summary.checks.dynamicElapsedWithoutReadings = true;

  // Unsupported storage is explicit and never substitutes the dry reference.
  await api(`/experiments/${experiment.id}/sessions/${s1.id}/sample-status`, {
    method: 'PATCH', token, body: { sampleStatus: 'NOT_SPOILED', storageCondition: 'WATER' },
  });
  const water = await api(`/experiments/${experiment.id}/rsl/1`, { token });
  assert.equal(water.json.data.reason, 'UNSUPPORTED_STORAGE_CONDITION');
  assert.equal(water.json.data.primary, null);
  summary.checks.unsupportedStorage = true;

  // Unknown status is explicit.
  await api(`/experiments/${experiment.id}/sessions/${s1.id}/sample-status`, {
    method: 'PATCH', token, body: { sampleStatus: 'UNKNOWN', storageCondition: 'DRY' },
  });
  const unknown = await api(`/experiments/${experiment.id}/rsl/1`, { token });
  assert.equal(unknown.json.data.reason, 'SAMPLE_STATUS_UNKNOWN');
  summary.checks.unknownStatusNegative = true;

  // Negative elapsed is not converted into a positive estimate.
  await api(`/experiments/${experiment.id}/sessions/${s1.id}/sample-status`, {
    method: 'PATCH', token, body: { sampleStatus: 'NOT_SPOILED', storageCondition: 'DRY' },
  });
  await Experiment.updateOne({ _id: experiment.id }, { $set: { startedAt: new Date(Date.now() + 3600000) } });
  const negative = await api(`/experiments/${experiment.id}/rsl/1`, { token });
  assert.equal(negative.json.data.reason, 'NEGATIVE_ELAPSED_TIME');
  assert.equal(negative.json.data.primary, null);
  summary.checks.negativeElapsed = true;

  // Outside support is explicit.
  await Experiment.updateOne({ _id: experiment.id }, { $set: { startedAt: new Date(Date.now() - 43 * 3600000) } });
  const outside = await api(`/experiments/${experiment.id}/rsl/1`, { token });
  assert.equal(outside.json.data.reason, 'OUTSIDE_REFERENCE_SUPPORT');
  assert.equal(outside.json.data.primary, null);
  summary.checks.outsideSupport = true;

  // Restore a useful 20 h elapsed window for browser verification.
  await Experiment.updateOne({ _id: experiment.id }, { $set: { startedAt: new Date(Date.now() - 20 * 3600000) } });

  // Duplicate MQTT event is idempotent.
  const beforeDup = await SensorReading.countDocuments({ sampleId: sample });
  await publish('smartchamber/sensor/1', {
    event_id: `${sample}-ch1`, sample_id: sample, device_id: 'tofusense-E2E',
    chamber_id: 1, tvoc: 89, suhu: 30.59, rh: 66.45, sampled_at: sampledAt, timestamp: sampledAt,
  });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(await SensorReading.countDocuments({ sampleId: sample }), beforeDup);
  summary.checks.duplicateMqttIdempotent = true;

  // Future-dated reading is flagged and uses receipt time; it does not move RSL.
  const futureSample = `e2e9-future-${nowId()}`;
  const futureAt = new Date(Date.now() + 3600000).toISOString();
  await publish('smartchamber/sensor/1', {
    event_id: `${futureSample}-ch1`, sample_id: futureSample, device_id: 'tofusense-E2E',
    chamber_id: 1, tvoc: 90, suhu: 30, rh: 66, sampled_at: futureAt, timestamp: futureAt,
  });
  await waitFor(async () => (await SensorReading.countDocuments({ sampleId: futureSample })) === 1);
  const futureReading = await SensorReading.findOne({ sampleId: futureSample }).lean();
  assert.equal(futureReading.timestampQuality, 'INVALID');
  assert.equal(futureReading.sampledAt, null);
  summary.checks.futureDatedReadingFlagged = true;

  // Missing timestamp is flagged, not silently treated as sampled.
  const missingSample = `e2e9-missing-${nowId()}`;
  await publish('smartchamber/sensor/1', {
    event_id: `${missingSample}-ch1`, sample_id: missingSample, device_id: 'tofusense-E2E',
    chamber_id: 1, tvoc: 91, suhu: 30, rh: 66,
  });
  await waitFor(async () => (await SensorReading.countDocuments({ sampleId: missingSample })) === 1);
  const missingReading = await SensorReading.findOne({ sampleId: missingSample }).lean();
  assert.equal(missingReading.timestampQuality, 'MISSING');
  assert.equal(missingReading.sampledAt, null);
  summary.checks.missingTimestampFlagged = true;

  // Stop closes both sessions with one timestamp; repeat is idempotent.
  const stopped = await api(`/experiments/${experiment.id}/stop`, { method: 'POST', token });
  assert.equal(stopped.status, 200, stopped.text);
  const closedExperiment = await Experiment.findById(experiment.id).lean();
  const closedSessions = await Session.find({ experimentId: experiment.id }).lean();
  assert.equal(closedExperiment.status, 'selesai');
  assert.ok(closedExperiment.endedAt);
  assert.equal(closedSessions.length, 2);
  for (const s of closedSessions) {
    assert.equal(s.status, 'selesai');
    assert.equal(new Date(s.selesai).getTime(), new Date(closedExperiment.endedAt).getTime());
  }
  const stoppedAgain = await api(`/experiments/${experiment.id}/stop`, { method: 'POST', token });
  assert.equal(stoppedAgain.status, 200);
  assert.equal(stoppedAgain.json.data.alreadyStopped, true);
  const closedRsl = await api(`/experiments/${experiment.id}/rsl/1`, { token });
  assert.equal(closedRsl.status, 404);
  summary.checks.stopSharedTimestamp = true;
  summary.checks.stopIdempotent = true;
  summary.checks.closedExperimentNoRsl = true;

  summary.readingCounts = {
    chamber1: await SensorReading.countDocuments({ sesiId: s1.id }),
    chamber2: await SensorReading.countDocuments({ sesiId: s2.id }),
  };
  summary.final = {
    experimentStatus: closedExperiment.status,
    endedAt: closedExperiment.endedAt,
    sessionStatuses: closedSessions.map((s) => s.status),
  };
  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
