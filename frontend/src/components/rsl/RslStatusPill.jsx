'use client';

import { useI18n } from '@/context/I18nContext';
import { cn } from '@/lib/utils';

const LABEL = {
  AVAILABLE: 'Tersedia',
  REFERENCE_ONLY: 'Referensi',
  OK: 'OK',
  UNAVAILABLE: 'Tidak tersedia',
  NOT_AVAILABLE: 'Tidak tersedia',
  OUTSIDE_SUPPORT: 'Di luar dukungan',
  SUPPRESSED: 'Disembunyikan',
  SAMPLE_REPORTED_SPOILED: 'Sampel rusak',
  UNSUPPORTED_CONDITION: 'Kondisi tidak didukung',
};

const STYLE = {
  AVAILABLE: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  REFERENCE_ONLY: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  OK: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  UNAVAILABLE: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  NOT_AVAILABLE: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  OUTSIDE_SUPPORT: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  SUPPRESSED: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  SAMPLE_REPORTED_SPOILED: 'bg-red-50 text-red-700 ring-red-600/20',
  UNSUPPORTED_CONDITION: 'bg-amber-50 text-amber-700 ring-amber-600/20',
};

export default function RslStatusPill({ status, className = '' }) {
  const { t } = useI18n();
  const key = status || 'NOT_AVAILABLE';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
        STYLE[key] || STYLE.NOT_AVAILABLE,
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {t(LABEL[key] || key)}
    </span>
  );
}
