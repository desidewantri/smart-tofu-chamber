import { EN, PATTERNS } from '@/i18n/en';

/**
 * Bahasa aktif disimpan di sini agar fungsi biasa (format tanggal, durasi) ikut berganti.
 * Teks sumber selalu bahasa Indonesia; terjemahan Inggris dicari di kamus (src/i18n/en.js).
 * Teks dari server (notifikasi, interpretasi, pesan galat) dicocokkan dengan PATTERNS.
 */
let current = 'id';

export const getLang = () => current;
export const setLang = (lang) => {
  current = lang === 'en' ? 'en' : 'id';
};
export const getLocale = () => (current === 'en' ? 'en-US' : 'id-ID');

function fill(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

export function translate(lang, text, vars) {
  if (text === null || text === undefined || text === '') return text;
  if (lang !== 'en') return fill(String(text), vars);
  const src = String(text);
  if (Object.prototype.hasOwnProperty.call(EN, src)) return fill(EN[src], vars);
  const tr = (s) => translate('en', s);
  for (const [re, fn] of PATTERNS) {
    const m = src.match(re);
    if (m) return fn(m, tr);
  }
  return fill(src, vars);
}

/** Terjemahan memakai bahasa aktif saat ini (untuk fungsi non-React). */
export const tNow = (text, vars) => translate(current, text, vars);
