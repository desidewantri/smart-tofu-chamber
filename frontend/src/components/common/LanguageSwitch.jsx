'use client';

import { Languages } from 'lucide-react';
import { useI18n } from '@/context/I18nContext';
import { cn } from '@/lib/utils';

/** Pemilih bahasa: Indonesia / English. Pilihan disimpan di peramban. */
export default function LanguageSwitch({ className = '' }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div
      className={cn('inline-flex items-center gap-1 rounded-xl p-1 text-xs font-bold', /\bbg-/.test(className) ? '' : 'bg-slate-100', className)}
      role="group"
      aria-label={t('Bahasa')}
    >
      <Languages className="ml-1.5 h-4 w-4 text-slate-400" aria-hidden="true" />
      {[
        ['id', 'ID'],
        ['en', 'EN'],
      ].map(([code, label]) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          title={code === 'id' ? 'Bahasa Indonesia' : 'English'}
          className={cn(
            'rounded-lg px-2.5 py-1.5 transition',
            lang === code ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
