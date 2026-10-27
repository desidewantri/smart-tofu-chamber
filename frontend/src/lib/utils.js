import { getLang, getLocale, tNow } from '@/lib/locale';

export const cn = (...classes) => classes.filter(Boolean).join(' ');

export const pad = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

/** detik -> { h, m, s } */
export function splitSeconds(totalSec) {
  const t = Math.max(0, Math.floor(totalSec || 0));
  return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

/** 21540 -> "5j 59m" */
export function formatDurationShort(totalSec) {
  const { h, m } = splitSeconds(totalSec);
  const hu = getLang() === 'en' ? 'h' : 'j';
  if (h === 0) return `${m}m`;
  return `${h}${hu} ${m}m`;
}

/** 23940 -> "6 jam 39 menit" */
export function formatDurationLong(totalSec) {
  const { h, m } = splitSeconds(totalSec);
  return getLang() === 'en' ? `${h} hr ${m} min` : `${h} jam ${m} menit`;
}

/**
 * Sisa umur dalam jam saja (prediksi tidak setepat menit).
 * Dibulatkan ke BAWAH agar tidak melebih-lebihkan sisa umur dan selalu sejalan dengan status.
 * 23940 -> "±6 jam"
 */
export function hoursLeft(totalSec) {
  return Math.floor(Math.max(0, totalSec || 0) / 3600);
}
export function formatHoursLeft(totalSec) {
  const en = getLang() === 'en';
  const h = hoursLeft(totalSec);
  if ((totalSec || 0) <= 0) return en ? 'Expired' : 'Habis';
  if (h < 1) return en ? '< 1 hr' : '< 1 jam';
  return en ? `±${h} hr` : `±${h} jam`;
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(getLocale(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d);
}

export function formatMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(getLocale(), { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1))
  );
}

export function formatRupiah(n) {
  if (n === null || n === undefined) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}Rp${Math.abs(Math.round(n)).toLocaleString(getLocale())}`;
}

/** "2 menit lalu", "3 jam lalu", "2 hari lalu" */
export function formatRelative(value, now = Date.now()) {
  if (!value) return tNow('Belum pernah');
  const diff = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
  if (diff < 10) return tNow('Baru saja');
  if (diff < 60) return tNow('{n} detik lalu', { n: diff });
  if (diff < 3600) return tNow('{n} menit lalu', { n: Math.floor(diff / 60) });
  if (diff < 86400) return tNow('{n} jam lalu', { n: Math.floor(diff / 3600) });
  return tNow('{n} hari lalu', { n: Math.floor(diff / 86400) });
}

/* ---------------- Status & zona ---------------- */

export const STATUS = {
  LAYAK: 'Layak Jual',
  SEGERA: 'Segera Jual',
  TIDAK: 'Tidak Layak Jual',
};

export function classifyShelfLife(hours, zones = { segarHours: 24, rawanHours: 8 }) {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return null;
  if (hours > zones.segarHours) return STATUS.LAYAK;
  if (hours >= zones.rawanHours) return STATUS.SEGERA;
  return STATUS.TIDAK;
}

/** Warna per status (kelas Tailwind harus tertulis utuh agar tidak ter-purge). */
export const STATUS_STYLES = {
  [STATUS.LAYAK]: {
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    dot: 'bg-emerald-500',
    card: 'border-emerald-200 bg-[#f4fcf7]',
    text: 'text-emerald-700',
    soft: 'bg-emerald-50',
    hex: '#16a34a',
  },
  [STATUS.SEGERA]: {
    badge: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    dot: 'bg-amber-500',
    card: 'border-amber-200 bg-[#fffcf0]',
    text: 'text-amber-700',
    soft: 'bg-amber-50',
    hex: '#d97706',
  },
  [STATUS.TIDAK]: {
    badge: 'bg-red-50 text-red-700 ring-red-600/20',
    dot: 'bg-red-500',
    card: 'border-red-200 bg-[#fef6f6]',
    text: 'text-red-700',
    soft: 'bg-red-50',
    hex: '#dc2626',
  },
};

export const NEUTRAL_STYLE = {
  badge: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  dot: 'bg-slate-400',
  card: 'border-slate-200 bg-white',
  text: 'text-slate-600',
  soft: 'bg-slate-50',
  hex: '#64748b',
};

export const ZONE_STYLES = {
  Aman: { badge: 'text-emerald-700', bar: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  Perhatian: { badge: 'text-amber-700', bar: 'bg-amber-500', pill: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  Bahaya: { badge: 'text-red-700', bar: 'bg-red-500', pill: 'bg-red-50 text-red-700 ring-red-600/20' },
};

/** Label periode (teks sumber Indonesia; terjemahkan dengan t() saat ditampilkan). */
export const PERIOD_OPTIONS = [
  { value: '24h', label: '24 jam terakhir' },
  { value: '7d', label: '7 hari terakhir' },
  { value: '30d', label: '30 hari terakhir' },
  { value: '90d', label: '90 hari terakhir' },
  { value: '180d', label: '6 bulan terakhir' },
  { value: '365d', label: '1 tahun terakhir' },
];
