import { Clock } from 'lucide-react';
import { cn, pad, splitSeconds } from '@/lib/utils';

/** Hitung mundur besar: jam · menit (+ detik kecil). */
export default function ShelfLifeTimer({ seconds, textClass = 'text-slate-900' }) {
  const { h, m, s } = splitSeconds(seconds);
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Clock className="h-3.5 w-3.5" /> Sisa Umur Tahu
      </p>
      <div className={cn('mt-1 flex items-end gap-1 font-bold tabular-nums', textClass)} aria-live="off">
        <span className="text-5xl leading-none">{pad(h)}</span>
        <span className="pb-1 text-sm font-semibold text-slate-500">jam</span>
        <span className="ml-2 text-5xl leading-none">{pad(m)}</span>
        <span className="pb-1 text-sm font-semibold text-slate-500">menit</span>
        <span className="ml-2 pb-0.5 text-xl font-semibold text-slate-400">{pad(s)}</span>
        <span className="pb-1 text-xs font-semibold text-slate-400">dtk</span>
      </div>
    </div>
  );
}
