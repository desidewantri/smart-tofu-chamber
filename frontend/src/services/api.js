/**
 * Satu-satunya pintu komunikasi frontend -> backend.
 * NEXT_PUBLIC_USE_MOCK=true  : memakai data tiruan di browser (src/mock), tanpa backend.
 * NEXT_PUBLIC_USE_MOCK=false : memanggil REST API backend (NEXT_PUBLIC_API_URL).
 */
import { mockApi } from '@/mock/mockApi';

export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true';
const BASE = `${(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '')}/api`;
const TOKEN_KEY = 'stc_token';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export const tokenStore = {
  get() {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* penyimpanan tidak tersedia */
    }
  },
  clear() {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* abaikan */
    }
  },
};

async function request(method, path, { query, body } = {}) {
  const url = new URL(`${BASE}${path}`);
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== 'all') url.searchParams.set(k, v);
  });

  const headers = { 'Content-Type': 'application/json' };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch {
    throw new ApiError(
      'Tidak dapat terhubung ke server. Pastikan backend berjalan di ' +
        BASE.replace('/api', '') +
        ' atau jalankan mode demo (npm run dev:mock).',
      0
    );
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !PUBLIC_AUTH.includes(path)) {
      tokenStore.clear();
      if (typeof window !== 'undefined' && !/^\/(login|register)/.test(window.location.pathname)) {
        window.location.href = '/login';
      }
    }
    throw new ApiError(json.message || `Permintaan gagal (${res.status})`, res.status);
  }
  return json;
}

const PUBLIC_AUTH = ['/auth/login', '/auth/register', '/auth/google', '/auth/config'];

const realApi = {
  // auth
  login: (email, password, remember) => request('POST', '/auth/login', { body: { email, password, remember } }).then((j) => j.data),
  register: (body) => request('POST', '/auth/register', { body }).then((j) => j.data),
  googleLogin: (credential) => request('POST', '/auth/google', { body: { credential } }).then((j) => j.data),
  authConfig: () => request('GET', '/auth/config').then((j) => j.data),
  me: () => request('GET', '/auth/me').then((j) => j.data.user),
  updateProfile: (body) => request('PUT', '/auth/profile', { body }),
  changePassword: (body) => request('PUT', '/auth/password', { body }),

  // dashboard
  getDashboard: () => request('GET', '/dashboard').then((j) => j.data),
  getNotifications: () => request('GET', '/notifications').then((j) => j.data),
  getBattery: () => request('GET', '/battery').then((j) => j.data),

  // chambers
  getChambers: (q) => request('GET', '/chambers', { query: { q } }).then((j) => j.data),
  getChamber: (id) => request('GET', `/chambers/${id}`).then((j) => j.data),
  updateChamber: (id, body) => request('PUT', `/chambers/${id}`, { body }),
  closeSession: (chamberId) => request('POST', `/chambers/${chamberId}/selesai`),

  // sesi / riwayat
  getSessions: (params) => request('GET', '/sesi', { query: params }).then((j) => j.data),
  getSession: (id) => request('GET', `/sesi/${id}`).then((j) => j.data),

  // analisis
  getCondition: (params) => request('GET', '/analysis/condition', { query: params }).then((j) => j.data),
  getCostBenefit: (params) => request('GET', '/analysis/cost-benefit', { query: params }).then((j) => j.data),
  getSeasonal: (params) => request('GET', '/analysis/seasonal', { query: params }).then((j) => j.data),

  // pengaturan
  getSettings: () => request('GET', '/settings').then((j) => j.data),
  updateSettings: (body) => request('PUT', '/settings', { body }),
  testWhatsApp: (target) => request('POST', '/notifications/whatsapp/test', { body: target ? { target } : {} }),
};

export const api = USE_MOCK ? mockApi : realApi;
