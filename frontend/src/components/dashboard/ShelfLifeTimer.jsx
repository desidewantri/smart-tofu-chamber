'use client';

import { Clock } from 'lucide-react';
import { useI18n } from '@/context/I18nContext';
import { cn, hoursLeft } from '@/lib/utils';

/** Perkiraan sisa umur dalam jam saja, dibulatkan ke bawah. */
export default function ShelfLifeTimer({ seconds, textClass = 'text-slate-900' }) {
  const { t } = useI18n();
  const h = hoursLeft(seconds);
  const expired = (seconds || 0) <= 0;
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <Clock className="h-3.5 w-3.5" /> {t('Perkiraan Sisa Umur Tahu')}
      </p>
      <div className={cn('mt-0.5 flex items-baseline gap-1.5 font-bold tabular-nums', textClass)} aria-live="off">
        {expired ? (
          <span className="text-3xl leading-none">{t('Habis')}</span>
        ) : (
          <>
            <span className="text-[34px] leading-none">{h < 1 ? '< 1' : `±${h}`}</span>
            <span className="whitespace-nowrap text-sm font-semibold text-slate-500">{t('jam lagi')}</span>
          </>
        )}
      </div>
    </div>
  );
}
