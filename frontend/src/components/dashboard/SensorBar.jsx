'use client';

import { useI18n } from '@/context/I18nContext';
import { ZonePill } from '@/components/common/StatusBadge';
import { ZONE_STYLES, cn } from '@/lib/utils';

/** Satu baris sensor: ikon, nilai, bar zona, dan label Aman/Perhatian/Bahaya. */
export default function SensorBar({ icon: Icon, label, reading, limits, decimals = 0 }) {
  const { t } = useI18n();
  if (!reading) return null;
  const max = limits.perhatian * 1.5;
  const pct = Math.max(4, Math.min(100, (reading.value / max) * 100));
  const style = ZONE_STYLES[reading.zone];
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-slate-600">{t(label)}</span>
          <span className="text-sm font-bold tabular-nums text-slate-900">
            {Number(reading.value).toFixed(decimals)} <span className="text-xs font-medium text-slate-500">{reading.unit}</span>
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className={cn('h-full rounded-full transition-all duration-500', style?.bar)} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="w-[76px] text-right">
        <ZonePill zone={reading.zone} />
      </div>
    </div>
  );
}

/** Versi ringkas untuk kartu dasbor: ikon + nama, nilai, bar tipis, dan label zona dalam satu kolom. */
export function SensorTile({ icon: Icon, label, reading, limits, decimals = 0 }) {
  const { t } = useI18n();
  if (!reading) return null;
  const max = limits.perhatian * 1.5;
  const pct = Math.max(4, Math.min(100, (reading.value / max) * 100));
  const style = ZONE_STYLES[reading.zone];
  return (
    <div className="min-w-0 rounded-xl bg-white/70 px-3 py-2 ring-1 ring-inset ring-slate-200/60">
      <div className="flex flex-wrap items-center justify-between gap-x-1">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-medium text-slate-500">
          <Icon className="h-3.5 w-3.5" /> {t(label)}
        </span>
        <span className={cn('text-[11px] font-bold', style?.badge)}>{t(reading.zone)}</span>
      </div>
      <p className="mt-0.5 text-lg font-bold tabular-nums leading-tight text-slate-900">
        {Number(reading.value).toFixed(decimals)} <span className="text-xs font-medium text-slate-500">{reading.unit}</span>
      </p>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={cn('h-full rounded-full transition-all duration-500', style?.bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
