/**
 * Data TIRUAN untuk mode demo (NEXT_PUBLIC_USE_MOCK=true). Seluruhnya sintetis.
 * Bentuk datanya sengaja sama dengan respons backend asli.
 */
export const DEFAULT_SETTINGS = {
  appName: 'TOSCHA',
  appDescription: 'Sistem pemantauan dan analitik prediktif untuk memperkirakan umur simpan tahu.',
  updateIntervalMinutes: 5,
  zones: { segarHours: 24, rawanHours: 8 },
  notifications: { enabled: true, onSegeraJual: true, onTidakLayak: true, onOffline: true, onLowBattery: true, whatsapp: { enabled: false, recipients: [] } },
  thresholds: {
    tvoc: { aman: 200, perhatian: 400 },
    suhu: { aman: 25, perhatian: 30 },
    rh: { aman: 75, perhatian: 85 },
  },
  business: {
    batchKg: 10,
    pricePerKg: 15000,
    discountSegera: 0.3,
    lossRateWithoutSystem: 0.15,
    operationalCostPerSession: 2000,
  },
};

const TSL_TABLE = [
  [4, 141],
  [10, 72],
  [20, 24],
  [25, 14],
  [30, 8],
];

export function baseTslHours(tempC) {
  const pts = TSL_TABLE.map(([t, h]) => [t, Math.log(h)]);
  let i = 0;
  if (tempC <= pts[0][0]) i = 0;
  else if (tempC >= pts[pts.length - 1][0]) i = pts.length - 2;
  else while (i < pts.length - 2 && tempC > pts[i + 1][0]) i += 1;
  const [t1, y1] = pts[i];
  const [t2, y2] = pts[i + 1];
  return Math.min(300, Math.max(1, Math.exp(y1 + ((tempC - t1) * (y2 - y1)) / (t2 - t1))));
}

export const tvocAt = (age, tsl) => 120 + 700 * Math.pow(Math.min(Math.max(age / tsl, 0), 1.3), 1.6);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 24 * 3600 * 1000;
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

const classify = (h, z) => (h > z.segarHours ? 'Layak Jual' : h >= z.rawanHours ? 'Segera Jual' : 'Tidak Layak Jual');

export function buildInitialState() {
  const now = Date.now();
  const rnd = mulberry32(20260524);
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

  const chambers = [
    { id: 'mc1', chamberId: 1, code: 'CHAMBER-1', name: 'Chamber 1', enabled: true, lastSeenAt: now },
    { id: 'mc2', chamberId: 2, code: 'CHAMBER-2', name: 'Chamber 2', enabled: true, lastSeenAt: now },
  ];

  const sessions = [];
  const HISTORY = 60;
  const starts = Array.from({ length: HISTORY }, () => now - (2 + rnd() * 356) * DAY).sort((a, b) => a - b);
  starts.forEach((startMs, i) => {
    const month = new Date(startMs).getUTCMonth() + 1;
    const rainy = [10, 11, 12, 1, 2, 3].includes(month);
    const tempC = (rainy ? 26 : 28) - rnd() * 9;
    const rhBase = (rainy ? 80 : 66) + (rnd() - 0.5) * 4;
    const tsl = baseTslHours(tempC) * (0.92 + rnd() * 0.16);
    const age = Math.max(1, tsl * (0.2 + rnd() * 0.8));
    const sisa = Math.max(0, tsl - age);
    const seq = i + 1;
    sessions.push({
      id: `ms${seq}`,
      sesiCode: `CH-${String(seq).padStart(3, '0')}`,
      chamberId: (i % 2) + 1,
      status: 'selesai',
      masuk: startMs,
      selesai: startMs + age * 3600000,
      tvocAwal: round(tvocAt(0, tsl), 1),
      suhuAwal: round(tempC, 2),
      rhAwal: round(rhBase, 1),
      shelfLifeMulai: round(tsl, 2),
      shelfLifeJam: round(sisa, 2),
      prediksiDibuat: startMs + age * 3600000,
      modelUsed: 'lstm',
      readingCount: Math.round((age * 60) / 5),
      statusAkhir: classify(sisa, settings.zones),
      sisaAkhirJam: round(sisa, 2),
      _sim: { tempC, rhBase, tsl },
    });
  });

  const live = [
    { chamberId: 1, tempC: 19.7, rhBase: 77, tsl: 26.0, age: 19.35 },
    { chamberId: 2, tempC: 20.2, rhBase: 72, tsl: 24.0, age: 10.35 },
  ];
  live.forEach((l, k) => {
    const seq = HISTORY + k + 1;
    const masuk = now - l.age * 3600000;
    sessions.push({
      id: `ms${seq}`,
      sesiCode: `CH-${String(seq).padStart(3, '0')}`,
      chamberId: l.chamberId,
      status: 'aktif',
      masuk,
      selesai: null,
      tvocAwal: round(tvocAt(0, l.tsl), 1),
      suhuAwal: l.tempC,
      rhAwal: l.rhBase,
      shelfLifeMulai: l.tsl,
      shelfLifeJam: round(l.tsl - l.age, 2),
      prediksiDibuat: now,
      modelUsed: 'lstm',
      readingCount: Math.round((l.age * 60) / 5),
      statusAkhir: null,
      sisaAkhirJam: null,
      _sim: { tempC: l.tempC, rhBase: l.rhBase, tsl: l.tsl },
    });
  });

  return {
    user: { id: 'mu1', name: 'Admin', email: 'admin@tofu.local', role: 'admin' },
    password: 'admin123',
    settings,
    chambers,
    sessions,
  };
}
