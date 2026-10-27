import { ZonePill } from '@/components/common/StatusBadge';
import { ZONE_STYLES, cn } from '@/lib/utils';

/** Satu baris sensor: ikon, nilai, bar zona, dan label Aman/Perhatian/Bahaya. */
export default function SensorBar({ icon: Icon, label, reading, limits, decimals = 0 }) {
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
          <span className="text-sm font-medium text-slate-600">{label}</span>
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
