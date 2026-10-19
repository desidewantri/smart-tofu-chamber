'use client';

import { Clock } from 'lucide-react';
import { useI18n } from '@/context/I18nContext';
import { cn, splitSeconds } from '@/lib/utils';

/** Hitung mundur: jam dan menit saja (tanpa detik). */
export default function ShelfLifeTimer({ seconds, textClass = 'text-slate-900' }) {
  const { t } = useI18n();
  const { h, m } = splitSeconds(seconds);
  return (
    <div>
      <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        <Clock className="h-4 w-4" /> {t('Sisa Umur Tahu')}
      </p>
      <div className={cn('mt-1 flex items-baseline gap-1.5 font-bold tabular-nums', textClass)} aria-live="off">
        <span className="text-5xl leading-none">{h}</span>
        <span className="mr-2 text-base font-semibold text-slate-500">{t('jam')}</span>
        <span className="text-5xl leading-none">{m}</span>
        <span className="text-base font-semibold text-slate-500">{t('menit')}</span>
      </div>
    </div>
  );
}
