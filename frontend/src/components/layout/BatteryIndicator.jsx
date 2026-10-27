'use client';

import { api } from '@/services/api';
import { useI18n } from '@/context/I18nContext';
import { usePolling } from '@/lib/hooks';
import { cn, formatRelative } from '@/lib/utils';

// Warna per status: latar lembut, garis tepi, teks angka, label kecil.
const TONE = {
  baik: { box: 'bg-emerald-50 ring-emerald-200', value: 'text-emerald-600', label: 'text-emerald-700', fill: '#059669' },
  sedang: { box: 'bg-amber-50 ring-amber-200', value: 'text-amber-600', label: 'text-amber-700', fill: '#d97706' },
  lemah: { box: 'bg-red-50 ring-red-200', value: 'text-red-600', label: 'text-red-700', fill: '#dc2626' },
  stale: { box: 'bg-slate-50 ring-slate-200', value: 'text-slate-400', label: 'text-slate-400', fill: '#94a3b8' },
};

function BatteryIcon({ percent, color }) {
  const w = Math.max(2, (17.4 * percent) / 100);
  return (
    <svg width="26" height="15" viewBox="0 0 28 15" fill="none" aria-hidden="true">
      <rect x="1" y="1.2" width="22.5" height="12.6" rx="3.6" stroke={color} strokeWidth="2" />
      <rect x="24.6" y="5" width="2.6" height="5" rx="1.2" fill={color} />
      <rect x="3.6" y="3.8" width={w} height="7.4" rx="2" fill={color} />
      {percent < 20 && <path d="M12.5 3.5 10 8h3l-1.6 3.6L15 6.8h-3z" fill="#fff" />}
    </svg>
  );
}

/** Baterai alat sensor di bilah atas. Tidak tampil bila alat belum pernah mengirim data baterai. */
export default function BatteryIndicator() {
  const { t } = useI18n();
  const { data } = usePolling(() => api.getBattery(), 60000, []);
  if (!data || data.percent === null || data.percent === undefined) return null;

  const tone = data.stale ? TONE.stale : TONE[data.level] || TONE.baik;
  const hint = data.stale
    ? `${t('Alat tidak mengirim data. Nilai terakhir')} ${formatRelative(data.at).toLowerCase()}`
    : `${t('Diperbarui')} ${formatRelative(data.at).toLowerCase()}`;

  return (
    <div
      className={cn('mr-1 flex items-center gap-2.5 rounded-2xl py-1.5 pl-1.5 pr-3 ring-1 ring-inset transition-colors sm:pr-3.5', tone.box)}
      title={hint}
      role="status"
      aria-label={`${t('Baterai alat')} ${data.percent}%`}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white shadow-sm sm:h-[34px] sm:w-[34px]">
        <BatteryIcon percent={data.percent} color={tone.fill} />
      </span>
      <span className="flex flex-col leading-none">
        <span className={cn('hidden text-[10px] font-bold uppercase tracking-[0.08em] sm:block', tone.label)}>{t('Baterai alat')}</span>
        <span className={cn('text-lg font-extrabold tabular-nums tracking-tight sm:mt-0.5 sm:text-xl', tone.value)}>
          {data.percent}
          <span className="ml-px text-xs font-bold">%</span>
        </span>
      </span>
    </div>
  );
}
