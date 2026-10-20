const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePayload } = require('../src/services/ingestService');
const { predict, normalizeModel } = require('../src/services/predictionService');
const analysis = require('../src/services/analysisService');
const { STATUS } = require('../src/utils/status');

test('validatePayload menerima payload contoh dari proposal', () => {
  const d = validatePayload({
    chamber_id: 1, tvoc: 312.5, suhu: 24.3, rh: 68.2, timestamp: '2026-05-24T08:05:00Z',
  });
  assert.equal(d.chamberId, 1);
  assert.equal(d.tvoc, 312.5);
  assert.equal(d.timestamp.toISOString(), '2026-05-24T08:05:00.000Z');
});

test('validatePayload memakai chamber id dari topik MQTT bila tidak ada di payload', () => {
  assert.equal(validatePayload({ tvoc: 100, suhu: 25, rh: 70 }, 2).chamberId, 2);
});

test('validatePayload menolak data tidak valid', () => {
  assert.throws(() => validatePayload(null), /objek JSON/);
  assert.throws(() => validatePayload({ chamber_id: 1, tvoc: -5, suhu: 25, rh: 70 }), /tvoc/);
  assert.throws(() => validatePayload({ chamber_id: 1, tvoc: 100, suhu: 200, rh: 70 }), /suhu/);
  assert.throws(() => validatePayload({ chamber_id: 1, tvoc: 100, suhu: 25, rh: 130 }), /rh/);
  assert.throws(() => validatePayload({ tvoc: 100, suhu: 25, rh: 70 }), /chamber_id/);
  assert.throws(() => validatePayload({ chamber_id: 1, tvoc: 'abc', suhu: 25, rh: 70 }), /tvoc/);
});

test('validatePayload mengganti timestamp rusak dengan waktu sekarang', () => {
  const d = validatePayload({ chamber_id: 1, tvoc: 1, suhu: 25, rh: 70, timestamp: 'bukan tanggal' });
  assert.ok(Math.abs(d.timestamp.getTime() - Date.now()) < 5000);
});

test('normalizeModel memetakan nama model ml-service', () => {
  assert.equal(normalizeModel('LSTM'), 'lstm');
  assert.equal(normalizeModel('RandomForest'), 'random_forest');
  assert.equal(normalizeModel('rf'), 'random_forest');
  assert.equal(normalizeModel('hybrid'), 'hybrid');
  assert.equal(normalizeModel(undefined), 'hybrid');
});

test('predict mode mock tidak memanggil jaringan', async () => {
  const r = await predict({ tvoc: 200, suhu: 25, rh: 70 }, 'mock');
  assert.equal(r.source, 'mock');
  assert.ok(r.shelfLifeJam > 0);
});

test('predict mode live memetakan respons FastAPI', async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ shelf_life_hours: 12.345, model_used: 'lstm' }) });
  try {
    const r = await predict({ tvoc: 200, suhu: 25, rh: 70 }, 'live');
    assert.deepEqual([r.shelfLifeJam, r.modelUsed, r.source], [12.35, 'lstm', 'live']);
  } finally {
    global.fetch = original;
  }
});

test('predict mode auto jatuh ke mock bila ml-service gagal; mode live melempar error', async () => {
  const original = global.fetch;
  const warn = console.warn;
  console.warn = () => {};
  global.fetch = async () => { throw new Error('ECONNREFUSED'); };
  try {
    const r = await predict({ tvoc: 200, suhu: 25, rh: 70 }, 'auto');
    assert.equal(r.source, 'mock');
    await assert.rejects(() => predict({ tvoc: 200, suhu: 25, rh: 70 }, 'live'), /ECONNREFUSED/);
  } finally {
    global.fetch = original;
    console.warn = warn;
  }
});

test('computeCostBenefit menghitung pendapatan sesuai status akhir', () => {
  const settings = {
    business: { batchKg: 10, pricePerKg: 10000, discountSegera: 0.5, lossRateWithoutSystem: 0.2, operationalCostPerSession: 1000 },
  };
  const sessions = [
    { status: 'selesai', statusAkhir: STATUS.LAYAK },
    { status: 'selesai', statusAkhir: STATUS.SEGERA },
    { status: 'selesai', statusAkhir: STATUS.TIDAK },
    { status: 'aktif', statusAkhir: null },
  ];
  const r = analysis.computeCostBenefit(sessions, settings);
  assert.equal(r.sessions, 3);
  assert.equal(r.revenueWithSystem, 100000 + 50000 + 0);
  assert.equal(r.revenueWithoutSystem, 3 * 10 * 0.8 * 10000);
  assert.equal(r.operationalCost, 3000);
  assert.equal(r.netBenefit, 150000 - 240000 - 3000);
});

test('seasonOf: Oktober-Maret hujan, April-September kemarau', () => {
  assert.equal(analysis.seasonOf(1), 'hujan');
  assert.equal(analysis.seasonOf(10), 'hujan');
  assert.equal(analysis.seasonOf(4), 'kemarau');
  assert.equal(analysis.seasonOf(9), 'kemarau');
});

test('groupSeasonal mengelompokkan per bulan dan per musim', () => {
  const rows = [
    { date: '2026-01-10T00:00:00Z', tvoc: 100, suhu: 25, rh: 80, shelfLife: 20 },
    { date: '2026-01-20T00:00:00Z', tvoc: 120, suhu: 26, rh: 82, shelfLife: 22 },
    { date: '2026-07-05T00:00:00Z', tvoc: 110, suhu: 28, rh: 65, shelfLife: 10 },
  ];
  const g = analysis.groupSeasonal(rows);
  assert.equal(g.months.length, 2);
  assert.equal(g.months[0].month, '2026-01');
  assert.equal(g.months[0].sessions, 2);
  assert.equal(g.months[0].avgShelfLife, 21);
  const hujan = g.seasons.find((s) => s.season === 'hujan');
  const kemarau = g.seasons.find((s) => s.season === 'kemarau');
  assert.equal(hujan.sessions, 2);
  assert.equal(kemarau.sessions, 1);
  assert.match(g.insight, /hujan/);
});

test('groupSeasonal tanpa data memberi pesan data belum cukup', () => {
  assert.match(analysis.groupSeasonal([]).insight, /belum cukup/);
});

test('buildInterpretation menyebut parameter bermasalah dan disclaimer', () => {
  const text = analysis.buildInterpretation(STATUS.TIDAK, {
    tvoc: { zone: 'Bahaya' }, suhu: { zone: 'Aman' }, rh: { zone: 'Perhatian' },
  });
  assert.match(text, /TVOC/);
  assert.match(text, /bukan pengukuran langsung/);
  assert.match(analysis.buildInterpretation(null, null), /Belum ada data/);
});

const { normalizePhone } = require('../src/services/whatsappService');
const { buildMessage, formatRemaining } = require('../src/services/notifierService');

test('normalizePhone menyeragamkan format nomor Indonesia', () => {
  assert.equal(normalizePhone('0812-3456-7890'), '6281234567890');
  assert.equal(normalizePhone('+62 812 3456 7890'), '6281234567890');
  assert.equal(normalizePhone('81234567890'), '6281234567890');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone(''), null);
});

test('buildMessage menyusun pesan Segera Jual dengan sisa waktu dan sensor', () => {
  const msg = buildMessage({
    kind: 'segeraJual', chamberName: 'Chamber 1', sesiCode: 'CH-061', sisaDetik: 7 * 3600 + 50 * 60,
    reading: { suhu: 20.14, rh: 72, tvoc: 309.4 }, zones: { segarHours: 24, rawanHours: 8 },
  });
  assert.match(msg, /Chamber 1/);
  assert.match(msg, /CH-061/);
  assert.match(msg, /Segera Jual/);
  assert.match(msg, /±7 jam/);
  assert.doesNotMatch(msg, /menit/);
  assert.match(msg, /Suhu 20,1 °C/);
  assert.equal(formatRemaining(-5), 'kurang dari 1 jam');
  assert.equal(formatRemaining(6 * 3600 + 59 * 60), '±6 jam');
});
