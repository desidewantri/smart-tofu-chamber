'use client';

import { api } from '@/services/api';
import { useI18n } from '@/context/I18nContext';
import { usePolling } from '@/lib/hooks';
import { cn, formatRelative } from '@/lib/utils';

const TONE = {
  baik: { text: 'text-emerald-600', fill: '#059669' },
  sedang: { text: 'text-amber-600', fill: '#d97706' },
  lemah: { text: 'text-red-600', fill: '#dc2626' },
  stale: { text: 'text-slate-400', fill: '#94a3b8' },
};

function BatteryIcon({ percent, color }) {
  const w = Math.max(1.5, (16 * percent) / 100);
  return (
    <svg width="24" height="14" viewBox="0 0 26 14" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="21" height="12" rx="3" stroke={color} strokeWidth="2" />
      <rect x="23" y="4.5" width="2.5" height="5" rx="1" fill={color} />
      <rect x="3.5" y="3.5" width={w} height="7" rx="1.5" fill={color} />
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
      className="mr-1 flex items-center rounded-2xl bg-white px-3 py-1.5 shadow-sm sm:px-3.5"
      title={hint}
      role="status"
      aria-label={`${t('Baterai alat')} ${data.percent}%`}
    >
      <div className="flex flex-col leading-tight">
        <span className="hidden text-[10px] font-bold uppercase tracking-wider text-slate-500 sm:block">{t('Baterai alat')}</span>
        <span className={cn('flex items-center gap-1.5 text-[15px] font-extrabold', tone.text)}>
          <BatteryIcon percent={data.percent} color={tone.fill} />
          {data.percent}%
        </span>
      </div>
    </div>
  );
}
