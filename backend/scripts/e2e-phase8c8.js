/**
 * Phase 8C.8 local E2E validation.
 *
 * Requires the backend running on API_URL with:
 *   MONGODB_URI=mongodb://127.0.0.1:27017/smart_tofu_chamber_e2e
 *   MQTT_URL=mqtt://127.0.0.1:1883
 *   SHEET_URL= (empty; importer is exercised directly with local fixtures)
 *   ML_MODE=mock
 *
 * It never contacts production. It drops only the dedicated E2E database.
 */
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const mqtt = require('mqtt');

const Experiment = require('../src/models/Experiment');
const Session = require('../src/models/Session');
const SensorReading = require('../src/models/SensorReading');
const Prediction = require('../src/models/Prediction');
const ImportCursor = require('../src/models/ImportCursor');
const ImportReceipt = require('../src/models/ImportReceipt');
const Chamber = require('../src/models/Chamber');
const { processRows, parseCsv } = require('../src/services/sheetImportService');
const { ingestReading } = require('../src/services/ingestService');

const API = (process.env.API_URL || 'http://127.0.0.1:5098').replace(/\/$/, '');
const MQTT_URL = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
const DB_NAME = 'smart_tofu_chamber_e2e';
const DEVICE_KEY = process.env.DEVICE_API_KEY || 'e2e-device-key';

function nowId() {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function api(path, { method = 'GET', token = null, body = null, headers = {} } = {}) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
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
      clientId: `e2e-pub-${nowId()}`,
      reconnectPeriod: 0,
      connectTimeout: 5000,
    });
    const timer = setTimeout(() => {
      client.end(true);
      reject(new Error('MQTT publish timeout'));
    }, 8000);
    client.on('connect', () => {
      client.publish(topic, JSON.stringify(payload), { qos: 0 }, (err) => {
        clearTimeout(timer);
        if (err) {
          client.end(true);
          reject(err);
          return;
        }
        // QoS 0: give the broker a moment to receive the packet before the
        // clean disconnect. Force-closing immediately can drop the message.
        setTimeout(() => client.end(false, {}, () => resolve()), 400);
      });
    });
    client.on('error', (err) => {
      clearTimeout(timer);
      client.end(true);
      reject(err);
    });
  });
}

async function importFixture(csv, sourceId) {
  await ImportCursor.deleteMany({});
  return processRows(parseCsv(csv), {
    sourceId,
    mode: 'primary',
    models: { ImportCursor, ImportReceipt, Chamber },
    ingest: ingestReading,
  });
}

function phase7Csv(sampleId, sampledAt, tvoc1 = '88') {
  const header = 'received_at,sample_id,sampled_at,temp1,humid1,tvoc1,temp2,humid2,tvoc2,vbat';
  const row = ['11/5/2026', sampleId, sampledAt, '27.54', '78.92', tvoc1, '', '', '', ''].join(',');
  return [header, row].join('\n');
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  assert.equal(mongoose.connection.name, DB_NAME, 'E2E must use the dedicated database');
  await Promise.all([
    Experiment.init(),
    Session.init(),
    SensorReading.init(),
    Prediction.init(),
    ImportCursor.init(),
    ImportReceipt.init(),
  ]);

  const summary = { database: DB_NAME, checks: {} };

  // ---------- auth ----------
  const email = `e2e-${nowId()}@local.test`;
  const password = 'E2eLocal123!';
  let auth = await api('/auth/register', {
    method: 'POST',
    body: { name: 'E2E Operator', email, password },
  });
  if (auth.status !== 201) {
    auth = await api('/auth/login', { method: 'POST', body: { email, password } });
  }
  assert.ok(auth.json?.data?.token, 'auth token');
  const token = auth.json.data.token;
  summary.checks.auth = true;

  // ---------- start experiment ----------
  const started = await api('/experiments', {
    method: 'POST',
    token,
    body: { label: 'E2E Phase 8C.8' },
  });
  assert.equal(started.status, 201, 'experiment start status');
  const experiment = started.json.data.experiment;
  const startedSessions = started.json.data.sessions;
  assert.equal(startedSessions.length, 2);
  for (const s of startedSessions) {
    assert.equal(s.experimentId, experiment.id);
    assert.equal(s.masuk, null);
    assert.equal(s.tvocAwal, null);
  }
  summary.experimentId = experiment.id;
  summary.startedAt = experiment.startedAt;
  summary.chamber1SessionId = startedSessions.find((s) => s.chamberId === 1).id;
  summary.chamber2SessionId = startedSessions.find((s) => s.chamberId === 2).id;
  summary.checks.startExperiment = true;

  const experimentDoc = await Experiment.findById(experiment.id).lean();
  const sessionDocs = await Session.find({ experimentId: experimentDoc._id }).lean();
  assert.equal(sessionDocs.length, 2);
  assert.equal(String(sessionDocs.find((s) => s.chamberId === 1).experimentId), String(experimentDoc._id));
  summary.checks.twoLinkedSessions = true;

  // ---------- MQTT chamber 1 + 2 ----------
  const startMs = new Date(experiment.startedAt).getTime();
  const sampledAt = new Date().toISOString();
  const sample1 = `e2e-${nowId()}-1`;
  const base1 = { sample_id: sample1, device_id: 'e2e-device', sampled_at: sampledAt, timestamp: sampledAt };

  await publish('smartchamber/sensor/1', {
    ...base1, event_id: `${sample1}-ch1`, chamber_id: 1, tvoc: 88, suhu: 27.54, rh: 78.92,
  });
  await publish('smartchamber/sensor/2', {
    ...base1, event_id: `${sample1}-ch2`, chamber_id: 2, tvoc: 111, suhu: 27.53, rh: 77.56,
  });

  await waitFor(async () => (await SensorReading.countDocuments({ sampleId: sample1 })) === 2);
  const readings1 = await SensorReading.find({ sampleId: sample1 }).lean();
  assert.equal(readings1.length, 2);
  const r1 = readings1.find((r) => r.chamberId === 1);
  const r2 = readings1.find((r) => r.chamberId === 2);
  assert.equal(String(r1.sesiId), summary.chamber1SessionId);
  assert.equal(String(r2.sesiId), summary.chamber2SessionId);
  assert.equal(r1.source, 'mqtt');
  assert.deepEqual(r1.sources, ['mqtt']);
  assert.equal(r1.timestampQuality, 'OK');
  assert.equal(r1.sampledAt.toISOString(), sampledAt);
  summary.sampleId = sample1;
  summary.checks.mqttChamber1 = true;
  summary.checks.mqttChamber2 = true;

  const session1 = await Session.findById(summary.chamber1SessionId).lean();
  const session2 = await Session.findById(summary.chamber2SessionId).lean();
  assert.equal(session1.masuk.toISOString(), sampledAt);
  assert.equal(session2.masuk.toISOString(), sampledAt);
  assert.equal(session1.readingCount, 1);
  assert.equal(session2.readingCount, 1);
  assert.equal(String(session1.experimentId), experiment.id);
  summary.checks.firstReadingBaseline = true;
  summary.checks.readingCount = true;

  const predCount1 = await Prediction.countDocuments({ sesiId: session1._id });
  const predCount2 = await Prediction.countDocuments({ sesiId: session2._id });
  assert.equal(predCount1, 1);
  assert.equal(predCount2, 1);
  summary.predictionsAfterMqtt = predCount1 + predCount2;

  // ---------- dashboard / chamber API ----------
  const dash = await api('/dashboard', { token });
  assert.equal(dash.status, 200);
  const card1 = dash.json.data.active.find((c) => c.chamber.chamberId === 1);
  assert.ok(card1);
  assert.equal(card1.session.experimentId, experiment.id);
  assert.equal(card1.session.experimentStartedAt, experiment.startedAt);
  assert.equal(card1.latestReading.sources.includes('mqtt'), true);
  assert.equal(card1.latestReading.timestampQuality, 'OK');
  assert.ok(card1.chart.length >= 1);
  assert.ok(card1.chart[0].elapsedHours >= 0 && card1.chart[0].elapsedHours < 0.01, 'chart elapsed uses experiment start');
  summary.checks.dashboardExperiment = true;
  summary.checks.dashboardProvenance = true;
  summary.checks.sharedElapsed = true;

  const chamber = await api('/chambers/1', { token });
  assert.equal(chamber.status, 200);
  assert.equal(chamber.json.data.activeSession.id, summary.chamber1SessionId);
  assert.equal(chamber.json.data.latestReading.id, card1.latestReading.id);
  summary.checks.chamberLatestSessionScoped = true;

  // ---------- MQTT first, then Sheet duplicate ----------
  const beforeDedupReadings = await SensorReading.countDocuments({ sampleId: sample1 });
  const beforeDedupPreds = await Prediction.countDocuments({ sesiId: session1._id });
  const mqttFirst = await importFixture(phase7Csv(sample1, sampledAt), 'e2e:mqtt-first');
  assert.equal(mqttFirst.duplicates, 1);
  assert.equal(await SensorReading.countDocuments({ sampleId: sample1 }), beforeDedupReadings);
  assert.equal(await Prediction.countDocuments({ sesiId: session1._id }), beforeDedupPreds);
  const merged1 = await SensorReading.findOne({ sampleId: sample1, chamberId: 1 }).lean();
  assert.deepEqual(merged1.sources.sort(), ['mqtt', 'sheet']);
  assert.equal(merged1.tvoc, 88, 'MQTT measurement must not be overwritten by Sheet');
  summary.checks.mqttFirstSheetSecond = true;

  // ---------- Sheet first, then MQTT duplicate ----------
  const sample2 = `e2e-${nowId()}-2`;
  const sampled2 = new Date().toISOString();
  const sheetFirst = await importFixture(phase7Csv(sample2, sampled2), 'e2e:sheet-first');
  assert.equal(sheetFirst.imported, 1);
  const sheetReading = await SensorReading.findOne({ sampleId: sample2, chamberId: 1 }).lean();
  assert.equal(sheetReading.source, 'sheet');
  await publish('smartchamber/sensor/1', {
    sample_id: sample2,
    device_id: 'e2e-device',
    sampled_at: sampled2,
    timestamp: sampled2,
    event_id: `${sample2}-ch1`,
    chamber_id: 1,
    tvoc: 88,
    suhu: 27.54,
    rh: 78.92,
  });
  await waitFor(async () => {
    const r = await SensorReading.findOne({ sampleId: sample2, chamberId: 1 }).lean();
    return r && r.sources.includes('mqtt');
  });
  assert.equal(await SensorReading.countDocuments({ sampleId: sample2 }), 1);
  const merged2 = await SensorReading.findOne({ sampleId: sample2, chamberId: 1 }).lean();
  assert.deepEqual(merged2.sources.sort(), ['mqtt', 'sheet']);
  summary.checks.sheetFirstMqttSecond = true;

  // ---------- legacy Sheet row + idempotency ----------
  const legacyCsv = ['timestamp,temp1,humid1,tvoc1', '10/22/2026 21:34:43,27.5,79,88'].join('\n');
  const legacy1 = await importFixture(legacyCsv, 'e2e:legacy');
  assert.equal(legacy1.imported, 1);
  const legacyReading = await SensorReading.findOne({ sampleId: null, eventId: null, source: 'sheet' }).lean();
  assert.ok(legacyReading);
  assert.equal(legacyReading.sampledAt, null);
  assert.equal(legacyReading.timestampQuality, 'MISSING');
  const legacy2 = await importFixture(legacyCsv, 'e2e:legacy');
  assert.equal(legacy2.imported, 0);
  summary.checks.legacyIdempotent = true;

  // ---------- invalid TVOC sentinel ----------
  const sentinelSample = `e2e-${nowId()}-sentinel`;
  const sentinel = await importFixture(phase7Csv(sentinelSample, sampled2, '99999'), 'e2e:sentinel');
  assert.equal(sentinel.rejected, 1);
  assert.equal(await SensorReading.countDocuments({ sampleId: sentinelSample }), 0);
  const sentinelReceipt = await ImportReceipt.findOne({ sampleId: sentinelSample }).lean();
  assert.equal(sentinelReceipt.status, 'QUARANTINED_INVALID');
  assert.equal(sentinelReceipt.reason, 'INVALID_TVOC_SENTINEL');
  summary.checks.invalidSentinelQuarantined = true;

  // ---------- stop ----------
  const stop = await api(`/experiments/${experiment.id}/stop`, { method: 'POST', token });
  assert.equal(stop.status, 200);
  assert.equal(stop.json.data.experiment.status, 'selesai');
  assert.equal(stop.json.data.sessions.length, 2);
  const endedAt = stop.json.data.experiment.endedAt;
  for (const s of stop.json.data.sessions) {
    assert.equal(s.status, 'selesai');
    assert.equal(s.selesai, endedAt);
  }
  const stopAgain = await api(`/experiments/${experiment.id}/stop`, { method: 'POST', token });
  assert.equal(stopAgain.status, 200);
  assert.equal(stopAgain.json.data.alreadyStopped, true);
  summary.endedAt = endedAt;
  summary.checks.stopSharedTimestamp = true;
  summary.checks.stopIdempotent = true;

  // ---------- closed experiment rejects new data ----------
  const afterStopSample = `e2e-${nowId()}-after`;
  const beforeAfter = await SensorReading.countDocuments({});
  await publish('smartchamber/sensor/1', {
    sample_id: afterStopSample,
    device_id: 'e2e-device',
    sampled_at: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    event_id: `${afterStopSample}-ch1`,
    chamber_id: 1,
    tvoc: 88,
    suhu: 27.54,
    rh: 78.92,
  });
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(await SensorReading.countDocuments({ sampleId: afterStopSample }), 0);
  assert.equal(await SensorReading.countDocuments({}), beforeAfter);

  const httpAfterStop = await api('/sensor', {
    method: 'POST',
    headers: { 'x-api-key': DEVICE_KEY },
    body: { chamber_id: 1, tvoc: 88, suhu: 27.5, rh: 79 },
  });
  assert.equal(httpAfterStop.status, 409);
  assert.equal(httpAfterStop.json?.details?.code, 'NO_ACTIVE_EXPERIMENT');

  const sheetAfterStop = await importFixture(phase7Csv(`e2e-${nowId()}-sheet-after`, sampled2), 'e2e:after-stop');
  assert.equal(sheetAfterStop.unassigned, 1);
  assert.equal(await SensorReading.countDocuments({ sampleId: /^e2e-.*-sheet-after$/ }), 0);
  summary.checks.noActiveExperimentRejected = true;
  summary.checks.sheetUnassigned = true;

  // ---------- invalid payload ----------
  const invalid = await api('/sensor', {
    method: 'POST',
    headers: { 'x-api-key': DEVICE_KEY },
    body: { chamber_id: 1, tvoc: -1, suhu: 27.5, rh: 79 },
  });
  assert.equal(invalid.status, 400);
  summary.checks.invalidPayloadRejected = true;

  // ---------- final counts ----------
  const finalReadings = await SensorReading.countDocuments({});
  const finalPredictions = await Prediction.countDocuments({});
  const finalSessions = await Session.find({ experimentId: experimentDoc._id }).lean();
  summary.readings = finalReadings;
  summary.predictions = finalPredictions;
  summary.sessionReadingCounts = finalSessions.map((s) => ({ chamberId: s.chamberId, readingCount: s.readingCount }));
  summary.checks.finalCounts = true;

  // active experiment endpoint after stop
  const active = await api('/experiments/active', { token });
  assert.equal(active.status, 200);
  assert.equal(active.json.data, null);
  summary.checks.activeExperimentNullAfterStop = true;

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .then(() => mongoose.disconnect())
  .catch(async (err) => {
    console.error('E2E FAILED:', err.message);
    try { await mongoose.disconnect(); } catch { /* ignore */ }
    process.exit(1);
  });
