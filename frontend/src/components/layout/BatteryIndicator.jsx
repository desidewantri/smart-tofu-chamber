'use client';

import { api } from '@/services/api';
import { useI18n } from '@/context/I18nContext';
import { usePolling } from '@/lib/hooks';
import { cn, formatRelative } from '@/lib/utils';

// Warna ikon & angka per status (latar tetap putih).
const TONE = {
  baik: { value: 'text-emerald-600', fill: '#059669' },
  sedang: { value: 'text-amber-600', fill: '#d97706' },
  lemah: { value: 'text-red-600', fill: '#dc2626' },
};

const GREY = { value: 'text-slate-400', fill: '#94a3b8' };

function BatteryIcon({ percent, color }) {
  const empty = percent === null;
  const w = empty ? 0 : Math.max(2, (17.4 * percent) / 100);
  return (
    <svg width="24" height="14" viewBox="0 0 28 15" fill="none" aria-hidden="true">
      <rect x="1" y="1.2" width="22.5" height="12.6" rx="3.6" stroke={color} strokeWidth="2" />
      <rect x="24.6" y="5" width="2.6" height="5" rx="1.2" fill={color} />
      {empty ? (
        <path d="M8 7.5h8" stroke={color} strokeWidth="2" strokeLinecap="round" />
      ) : (
        <rect x="3.6" y="3.8" width={w} height="7.4" rx="2" fill={color} />
      )}
      {!empty && percent < 20 && percent > 0 && <path d="M12.5 3.5 10 8h3l-1.6 3.6L15 6.8h-3z" fill="#fff" />}
    </svg>
  );
}

/**
 * Baterai alat di bilah atas, sesuai DATA SENSOR TERAKHIR:
 *  - baterai kosong di data terakhir -> "–" (tidak ada data)
 *  - data lama (alat tidak mengirim) -> abu-abu + "x lalu"
 *  - selain itu persen dengan warna sesuai level.
 * Tidak tampil bila belum pernah ada data sensor sama sekali.
 */
export default function BatteryIndicator() {
  const { t } = useI18n();
  const { data } = usePolling(() => api.getBattery(), 60000, []);
  if (!data || data.noData || (data.percent === undefined && !data.at)) return null;

  const empty = data.percent === null || data.percent === undefined;
  const tone = empty || data.stale ? GREY : TONE[data.level] || TONE.baik;
  const sub = empty ? t('tidak ada data') : data.stale ? formatRelative(data.at).toLowerCase() : null;
  const hint = data.stale
    ? `${t('Alat tidak mengirim data. Nilai terakhir')} ${formatRelative(data.at).toLowerCase()}`
    : `${t('Diperbarui')} ${formatRelative(data.at).toLowerCase()}`;
  const value = empty ? '–' : `${data.percent}%`;

  return (
    <div
      className="mr-1 flex items-center rounded-2xl bg-white px-3 py-1.5 shadow-sm sm:px-3.5"
      title={hint}
      role="status"
      aria-label={`${t('Baterai alat')} ${empty ? t('tidak ada data') : value}`}
    >
      <div className="flex flex-col leading-tight">
        <span className="hidden text-[10px] font-bold uppercase tracking-wider text-slate-500 sm:block">{t('Baterai alat')}</span>
        <span className={cn('flex items-center gap-1.5 text-[15px] font-extrabold tabular-nums', tone.value)}>
          <BatteryIcon percent={empty ? null : data.percent} color={tone.fill} />
          {value}
        </span>
        {sub && <span className="text-[11px] font-semibold text-slate-500">{sub}</span>}
      </div>
    </div>
  );
}
