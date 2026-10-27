/**
 * API tiruan: meniru semua endpoint backend di memori browser.
 * Data hilang saat halaman di-refresh (disengaja, ini hanya mode demo).
 */
import { buildInitialState, tvocAt } from './mockData';

let state = null;
const S = () => {
  if (!state) state = buildInitialState();
  return state;
};

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const clone = (x) => JSON.parse(JSON.stringify(x));
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const fail = (message, status = 400) => {
  const e = new Error(message);
  e.status = status;
  return e;
};

const PERIOD_H = { '24h': 24, '7d': 168, '30d': 720, '90d': 2160, '180d': 4320, '365d': 8760 };

/* ---------- helpers ---------- */
const classify = (h, z) =>
  h === null || h === undefined ? null : h > z.segarHours ? 'Layak Jual' : h >= z.rawanHours ? 'Segera Jual' : 'Tidak Layak Jual';
const zoneOf = (v, l) => (v <= l.aman ? 'Aman' : v <= l.perhatian ? 'Perhatian' : 'Bahaya');
const chamberNo = (idOrCode) => {
  const m = /^CH-0*(\d+)$/i.exec(String(idOrCode));
  return m ? Number(m[1]) : Number(idOrCode);
};
const noise = (i, amp) => Math.sin(i * 12.9898) * 43758.5453 % 1 * amp;

function isConnected(c, now) {
  return Boolean(c.enabled && c.lastSeenAt && now - c.lastSeenAt < S().settings.updateIntervalMinutes * 3 * 60000);
}

function touchLive() {
  const now = Date.now();
  S().sessions.filter((s) => s.status === 'aktif').forEach((s) => {
    const c = S().chambers.find((x) => x.chamberId === s.chamberId);
    if (c) c.lastSeenAt = now - Math.floor(Math.random() * 40000);
  });
}

function chamberView(c, now = Date.now()) {
  return {
    id: c.id,
    chamberId: c.chamberId,
    code: c.code,
    name: c.name,
    enabled: c.enabled,
    connected: isConnected(c, now),
    lastSeenAt: iso(c.lastSeenAt),
  };
}

function sessionView(s, now = Date.now()) {
  const sisa = Math.max(0, Math.round(s.shelfLifeJam * 3600 - (now - s.prediksiDibuat) / 1000));
  const end = s.selesai || now;
  return {
    id: s.id,
    sesiCode: s.sesiCode,
    chamberId: s.chamberId,
    status: s.status,
    masuk: iso(s.masuk),
    selesai: iso(s.selesai),
    durasiDetik: Math.max(0, Math.round((end - s.masuk) / 1000)),
    tvocAwal: s.tvocAwal,
    suhuAwal: s.suhuAwal,
    rhAwal: s.rhAwal,
    shelfLifeMulai: s.shelfLifeMulai,
    shelfLifeJam: s.shelfLifeJam,
    prediksiDibuat: iso(s.prediksiDibuat),
    modelUsed: s.modelUsed,
    readingCount: s.readingCount,
    sisaDetik: sisa,
    statusLayak: classify(sisa / 3600, S().settings.zones),
    statusAkhir: s.statusAkhir,
    sisaAkhirJam: s.sisaAkhirJam,
  };
}

/** Pembacaan sensor + prediksi sintetis sepanjang umur sesi (tiap stepMin menit). */
function series(s, stepMin = 15, now = Date.now()) {
  const { tempC, rhBase, tsl } = s._sim;
  const end = s.selesai || now;
  const ageEnd = (end - s.masuk) / 3600000;
  const readings = [];
  const predictions = [];
  const steps = Math.max(1, Math.floor((ageEnd * 60) / stepMin));
  for (let i = 0; i <= steps; i += 1) {
    const age = i === steps ? ageEnd : (i * stepMin) / 60;
    const ts = s.masuk + age * 3600000;
    const tvoc = Math.max(20, tvocAt(age, tsl) + noise(i + s.masuk % 97, 10));
    const suhu = tempC + noise(i + 3, 0.25);
    const rh = Math.min(99, Math.max(30, rhBase + noise(i + 7, 1)));
    readings.push({ id: `${s.id}-r${i}`, chamberId: s.chamberId, tvoc: round(tvoc, 1), suhu: round(suhu, 2), rh: round(rh, 1), timestamp: iso(ts) });
    predictions.push({
      t: iso(ts),
      elapsedHours: round(age),
      shelfLife: round(Math.max(0.05, (tsl - age) * (1 + noise(i + 11, 0.03))), 2),
      shelfLifeJam: round(Math.max(0.05, (tsl - age) * (1 + noise(i + 11, 0.03))), 2),
      modelUsed: age < 1.5 ? 'random_forest' : 'lstm',
    });
  }
  return { readings, predictions };
}

function sensorsOf(reading) {
  const th = S().settings.thresholds;
  if (!reading) return null;
  return {
    tvoc: { value: reading.tvoc, unit: 'ppb', zone: zoneOf(reading.tvoc, th.tvoc) },
    suhu: { value: reading.suhu, unit: '°C', zone: zoneOf(reading.suhu, th.suhu) },
    rh: { value: reading.rh, unit: '%', zone: zoneOf(reading.rh, th.rh) },
  };
}

const LABEL = { tvoc: 'TVOC', suhu: 'Suhu', rh: 'Kelembapan' };
function riskNote(p, zone) {
  if (zone === 'Aman') return `${LABEL[p]} berada dalam batas aman; kontribusi terhadap risiko penurunan kualitas rendah.`;
  if (zone === 'Perhatian') return `${LABEL[p]} mendekati batas; pantau terus karena dapat mempercepat penurunan kualitas.`;
  return `${LABEL[p]} melewati batas; kondisi ini berkaitan dengan risiko penurunan kualitas yang lebih cepat.`;
}
function interpretation(status, sensors) {
  if (!status || !sensors) return 'Belum ada data sesi aktif untuk dianalisis. Interpretasi akan muncul setelah chamber mengirim data.';
  const bad = Object.entries(sensors).filter(([, v]) => v.zone === 'Bahaya').map(([k]) => LABEL[k]);
  const warn = Object.entries(sensors).filter(([, v]) => v.zone === 'Perhatian').map(([k]) => LABEL[k]);
  const lead =
    status === 'Layak Jual'
      ? 'Estimasi sisa shelf-life masih panjang; tahu layak dijual dengan tenang.'
      : status === 'Segera Jual'
      ? 'Estimasi sisa shelf-life mulai terbatas; sebaiknya tahu segera dijual.'
      : 'Estimasi sisa shelf-life sangat singkat; tahu tidak layak dijual dan perlu segera dikeluarkan.';
  const detail = bad.length
    ? ` Parameter yang melewati batas: ${bad.join(', ')}.`
    : warn.length
    ? ` Parameter yang perlu diperhatikan: ${warn.join(', ')}.`
    : ' Seluruh parameter berada dalam batas aman.';
  return `${lead}${detail} TVOC, suhu, dan kelembapan adalah parameter yang berkontribusi pada prediksi model, bukan pengukuran langsung terhadap kondisi mikrobiologis tahu.`;
}

const avg = (a) => {
  const v = a.filter((x) => typeof x === 'number');
  return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
};
const seasonOf = (m) => ([10, 11, 12, 1, 2, 3].includes(m) ? 'hujan' : 'kemarau');

/* ---------- API ---------- */
export const mockApi = {
  async login(email, password) {
    await delay(300);
    if (String(email).toLowerCase() !== S().user.email || password !== S().password) {
      throw fail('Email atau password salah', 401);
    }
    return { token: 'mock-token', user: clone(S().user) };
  },
  async me() {
    await delay(80);
    return clone(S().user);
  },
  async updateProfile(body) {
    await delay();
    if (body.name !== undefined) S().user.name = body.name;
    if (body.email !== undefined) S().user.email = String(body.email).toLowerCase();
    return { success: true, message: 'Profil diperbarui', data: { user: clone(S().user) } };
  },
  async changePassword({ currentPassword, newPassword }) {
    await delay();
    if (currentPassword !== S().password) throw fail('Password lama salah');
    if (String(newPassword).length < 6) throw fail('Password baru minimal 6 karakter');
    S().password = newPassword;
    return { success: true, message: 'Password berhasil diganti' };
  },

  async getDashboard() {
    await delay();
    touchLive();
    const now = Date.now();
    const cards = S().chambers.map((c) => {
      const s = S().sessions.find((x) => x.chamberId === c.chamberId && x.status === 'aktif');
      if (!s) return { chamber: chamberView(c, now), session: null, sensors: null, latestReading: null, chart: [] };
      const { readings, predictions } = series(s, 15, now);
      const latest = readings[readings.length - 1];
      return {
        chamber: chamberView(c, now),
        session: sessionView(s, now),
        latestReading: latest,
        sensors: sensorsOf(latest),
        chart: predictions.map((p) => ({ elapsedHours: p.elapsedHours, shelfLife: p.shelfLife })),
      };
    });
    const active = cards.filter((c) => c.session).sort((a, b) => a.session.sisaDetik - b.session.sisaDetik);
    return {
      serverTime: new Date(now).toISOString(),
      refreshSeconds: 10,
      updateIntervalMinutes: S().settings.updateIntervalMinutes,
      zones: clone(S().settings.zones),
      thresholds: clone(S().settings.thresholds),
      active,
      idle: cards.filter((c) => !c.session),
    };
  },

  async getNotifications() {
    await delay(80);
    const st = S().settings;
    if (!st.notifications.enabled) return [];
    const now = Date.now();
    const out = [];
    S().sessions.filter((s) => s.status === 'aktif').forEach((s) => {
      const v = sessionView(s, now);
      const c = S().chambers.find((x) => x.chamberId === s.chamberId);
      if (v.statusLayak === 'Tidak Layak Jual' && st.notifications.onTidakLayak) {
        out.push({ id: `t${s.id}`, level: 'danger', chamberId: s.chamberId, title: `${c.code} Tidak Layak Jual`, message: `Sisa shelf-life ${s.sesiCode} kurang dari ${st.zones.rawanHours} jam.`, time: v.prediksiDibuat });
      } else if (v.statusLayak === 'Segera Jual' && st.notifications.onSegeraJual) {
        out.push({ id: `s${s.id}`, level: 'warning', chamberId: s.chamberId, title: `${c.code} Segera Jual`, message: `Sisa shelf-life ${s.sesiCode} kurang dari ${st.zones.segarHours} jam.`, time: v.prediksiDibuat });
      }
    });
    return out;
  },

  async getChambers(q) {
    await delay();
    touchLive();
    const now = Date.now();
    const term = String(q || '').toLowerCase();
    return S().chambers
      .map((c) => {
        const s = S().sessions.find((x) => x.chamberId === c.chamberId && x.status === 'aktif');
        return { ...chamberView(c, now), sesiSaatIni: s ? s.sesiCode : null };
      })
      .filter((c) => !term || c.code.toLowerCase().includes(term) || c.name.toLowerCase().includes(term));
  },
  async getChamber(id) {
    await delay();
    touchLive();
    const no = chamberNo(id);
    const c = S().chambers.find((x) => x.chamberId === no);
    if (!c) throw fail('Chamber tidak ditemukan', 404);
    const active = S().sessions.find((x) => x.chamberId === no && x.status === 'aktif');
    const latest = active ? series(active).readings.slice(-1)[0] : null;
    return {
      chamber: chamberView(c),
      activeSession: active ? sessionView(active) : null,
      latestReading: latest,
      sensors: sensorsOf(latest),
      recentSessions: S().sessions.filter((x) => x.chamberId === no && x.status === 'selesai').sort((a, b) => b.selesai - a.selesai).slice(0, 5).map((x) => sessionView(x)),
    };
  },
  async createChamber({ name }) {
    await delay();
    if (!String(name || '').trim()) throw fail('Nama chamber wajib diisi');
    const no = Math.max(...S().chambers.map((c) => c.chamberId)) + 1;
    const c = { id: `mc${no}`, chamberId: no, code: `CH-${String(no).padStart(3, '0')}`, name: String(name).trim(), enabled: true, lastSeenAt: null };
    S().chambers.push(c);
    return { success: true, message: `Chamber ${c.code} ditambahkan`, data: chamberView(c) };
  },
  async updateChamber(id, body) {
    await delay();
    const c = S().chambers.find((x) => x.chamberId === chamberNo(id));
    if (!c) throw fail('Chamber tidak ditemukan', 404);
    if (body.name !== undefined) c.name = String(body.name).trim() || c.name;
    if (body.enabled !== undefined) c.enabled = Boolean(body.enabled);
    return { success: true, message: 'Chamber diperbarui', data: chamberView(c) };
  },
  async closeSession(chamberId) {
    await delay();
    const no = chamberNo(chamberId);
    const s = S().sessions.find((x) => x.chamberId === no && x.status === 'aktif');
    if (!s) throw fail(`Tidak ada sesi aktif di chamber ${no}`, 404);
    const v = sessionView(s);
    s.status = 'selesai';
    s.selesai = Date.now();
    s.statusAkhir = v.statusLayak;
    s.sisaAkhirJam = round(v.sisaDetik / 3600, 2);
    return { success: true, message: `Sesi ${s.sesiCode} di chamber ${no} ditutup`, data: sessionView(s) };
  },

  async getSessions(params = {}) {
    await delay();
    const page = Math.max(1, parseInt(params.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(params.limit, 10) || 10));
    const now = Date.now();
    let list = S().sessions.map((s) => sessionView(s, now));
    if (params.chamberId) list = list.filter((s) => s.chamberId === Number(params.chamberId));
    if (params.status) list = list.filter((s) => s.status === params.status);
    if (params.statusAkhir) list = list.filter((s) => s.statusAkhir === params.statusAkhir);
    if (params.q) list = list.filter((s) => s.sesiCode.toLowerCase().includes(String(params.q).toLowerCase()));
    if (params.from) list = list.filter((s) => new Date(s.masuk) >= new Date(params.from));
    if (params.to) list = list.filter((s) => new Date(s.masuk) <= new Date(`${params.to}T23:59:59.999Z`));
    if (params.sort === 'masuk') list.sort((a, b) => new Date(b.masuk) - new Date(a.masuk));
    else list.sort((a, b) => a.sisaDetik - b.sisaDetik);
    const total = list.length;
    return { items: list.slice((page - 1) * limit, page * limit), total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
  },
  async getSession(id) {
    await delay();
    const s = S().sessions.find((x) => x.id === id || x.sesiCode === String(id).toUpperCase());
    if (!s) throw fail('Sesi tidak ditemukan', 404);
    const { readings, predictions } = series(s, 30);
    const stat = (k) => {
      const v = readings.map((r) => r[k]);
      return { min: Math.min(...v), max: Math.max(...v), avg: round(v.reduce((a, b) => a + b, 0) / v.length) };
    };
    return {
      session: sessionView(s),
      stats: { tvoc: stat('tvoc'), suhu: stat('suhu'), rh: stat('rh'), readings: readings.length, predictions: predictions.length },
      readings,
      predictions,
    };
  },

  async getCondition({ chamberId, period }) {
    await delay();
    const no = chamberNo(chamberId);
    const c = S().chambers.find((x) => x.chamberId === no);
    if (!c) throw fail('Chamber tidak ditemukan', 404);
    const hours = PERIOD_H[period] || 24;
    const s =
      S().sessions.find((x) => x.chamberId === no && x.status === 'aktif') ||
      S().sessions.filter((x) => x.chamberId === no).sort((a, b) => b.masuk - a.masuk)[0];
    const base = { chamber: chamberView(c), period: period || '24h', session: null, status: null, remainingSeconds: null, shelfLifeHours: null, modelUsed: null, sensors: null, risks: null, interpretation: interpretation(null, null), trend: [] };
    if (!s) return base;
    const v = sessionView(s);
    const { readings, predictions } = series(s, 15);
    const ageNow = (Date.now() - s.masuk) / 3600000;
    const sensors = sensorsOf(readings[readings.length - 1]);
    const status = v.statusLayak;
    const trend = predictions
      .filter((p) => s.status === 'aktif' ? p.elapsedHours >= ageNow - hours : true)
      .map((p) => ({ t: p.t, elapsedHours: p.elapsedHours, shelfLife: p.shelfLife }));
    return {
      ...base,
      session: v,
      status,
      remainingSeconds: v.sisaDetik,
      shelfLifeHours: s.shelfLifeJam,
      modelUsed: s.modelUsed,
      sensors,
      risks: Object.fromEntries(Object.entries(sensors).map(([k, x]) => [k, riskNote(k, x.zone)])),
      interpretation: interpretation(status, sensors),
      trend,
    };
  },

  async getCostBenefit({ chamberId, period }) {
    await delay();
    const b = S().settings.business;
    const since = Date.now() - (PERIOD_H[period] || 720) * 3600000;
    const done = S().sessions.filter((s) => s.status === 'selesai' && s.selesai >= since && (!chamberId || s.chamberId === Number(chamberId)));
    const counts = { 'Layak Jual': 0, 'Segera Jual': 0, 'Tidak Layak Jual': 0 };
    done.forEach((s) => { counts[s.statusAkhir] += 1; });
    const unit = b.batchKg * b.pricePerKg;
    const withSys = counts['Layak Jual'] * unit + counts['Segera Jual'] * unit * (1 - b.discountSegera);
    const without = done.length * b.batchKg * (1 - b.lossRateWithoutSystem) * b.pricePerKg;
    const op = done.length * b.operationalCostPerSession;
    return {
      period: period || '30d',
      chamberId: chamberId || null,
      sessions: done.length,
      totalKg: done.length * b.batchKg,
      counts,
      revenueWithSystem: Math.round(withSys),
      revenueWithoutSystem: Math.round(without),
      operationalCost: Math.round(op),
      netBenefit: Math.round(withSys - without - op),
      assumptions: [
        `Berat tahu per sesi ${b.batchKg} kg, harga Rp${b.pricePerKg.toLocaleString('id-ID')}/kg.`,
        `Tahu "Segera Jual" dijual dengan diskon ${Math.round(b.discountSegera * 100)}%; "Tidak Layak Jual" dianggap tidak terjual.`,
        `Tanpa sistem diasumsikan ${Math.round(b.lossRateWithoutSystem * 100)}% tahu terbuang (asumsi, perlu divalidasi dengan data produsen).`,
        `Biaya operasional Rp${b.operationalCostPerSession.toLocaleString('id-ID')} per sesi.`,
      ],
    };
  },

  async getSeasonal({ chamberId, period }) {
    await delay();
    const since = Date.now() - (PERIOD_H[period] || 8760) * 3600000;
    const rows = S().sessions.filter((s) => s.masuk >= since && (!chamberId || s.chamberId === Number(chamberId)));
    const byMonth = new Map();
    rows.forEach((s) => {
      const d = new Date(s.masuk);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(s);
    });
    const agg = (list) => ({
      sessions: list.length,
      avgSuhu: avg(list.map((s) => s.suhuAwal)) === null ? null : round(avg(list.map((s) => s.suhuAwal))),
      avgRh: avg(list.map((s) => s.rhAwal)) === null ? null : round(avg(list.map((s) => s.rhAwal))),
      avgTvoc: avg(list.map((s) => s.tvocAwal)) === null ? null : round(avg(list.map((s) => s.tvocAwal))),
      avgShelfLife: avg(list.map((s) => s.shelfLifeMulai)) === null ? null : round(avg(list.map((s) => s.shelfLifeMulai))),
    });
    const months = [...byMonth.keys()].sort().map((key) => ({ month: key, season: seasonOf(Number(key.slice(5))), ...agg(byMonth.get(key)) }));
    const seasons = ['hujan', 'kemarau'].map((season) => ({
      season,
      ...agg(rows.filter((s) => seasonOf(new Date(s.masuk).getUTCMonth() + 1) === season)),
    }));
    const [h, k] = seasons;
    let insight = 'Data belum cukup untuk membandingkan musim hujan dan kemarau.';
    if (h.sessions && k.sessions && h.avgShelfLife && k.avgShelfLife) {
      const diff = ((k.avgShelfLife - h.avgShelfLife) / h.avgShelfLife) * 100;
      insight = `Rata-rata estimasi shelf-life awal lebih panjang pada musim ${diff >= 0 ? 'kemarau' : 'hujan'} (selisih ${Math.abs(Math.round(diff))}%). Perbedaan suhu ruang (${h.avgSuhu}°C vs ${k.avgSuhu}°C) adalah faktor yang paling mungkin menjelaskannya. Ini deskripsi data, bukan bukti sebab-akibat.`;
    }
    return { period: period || '365d', chamberId: chamberId || null, months, seasons, insight };
  },

  async getSettings() {
    await delay(80);
    return clone(S().settings);
  },
  async updateSettings(body) {
    await delay();
    const st = S().settings;
    if (body.updateIntervalMinutes !== undefined) {
      const n = Number(body.updateIntervalMinutes);
      if (!(n >= 1 && n <= 60)) throw fail('Interval harus 1-60 menit');
    }
    if (body.zones) {
      const z = { ...st.zones, ...body.zones };
      if (!(z.rawanHours > 0 && z.segarHours > z.rawanHours)) throw fail('Batas segar harus lebih besar dari batas rawan, dan keduanya > 0');
    }
    const merge = (t, src) => Object.entries(src).forEach(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) { t[k] = t[k] || {}; merge(t[k], v); } else t[k] = v;
    });
    merge(st, body);
    return { success: true, message: 'Pengaturan disimpan', data: clone(st) };
  },
};
