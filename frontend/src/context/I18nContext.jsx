'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setLang as setModuleLang, translate } from '@/lib/locale';

const KEY = 'stc_lang';
const I18nContext = createContext({ lang: 'id', setLang: () => {}, t: (s) => s });

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState('id');
  setModuleLang(lang);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved === 'en' || saved === 'id') setLangState(saved);
    } catch {
      /* penyimpanan tidak tersedia */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next) => {
    setLangState(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* abaikan */
    }
  }, []);

  const t = useCallback((text, vars) => translate(lang, text, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
