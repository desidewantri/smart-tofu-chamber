'use client';

import { cn, STATUS_STYLES, NEUTRAL_STYLE, ZONE_STYLES } from '@/lib/utils';
import { useI18n } from '@/context/I18nContext';

/** Badge status shelf-life: Layak Jual / Segera Jual / Tidak Layak Jual (atau teks bebas bergaya netral). */
export function StatusBadge({ status, className = '', children }) {
  const { t } = useI18n();
  const style = STATUS_STYLES[status] || NEUTRAL_STYLE;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset',
        style.badge,
        className
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
      {children ? t(children) : status && !status.startsWith('__') ? t(status) : '—'}
    </span>
  );
}

/** Pil zona parameter sensor: Aman / Perhatian / Bahaya. */
export function ZonePill({ zone }) {
  const { t } = useI18n();
  const style = ZONE_STYLES[zone];
  if (!style) return null;
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', style.pill)}>{t(zone)}</span>
  );
}

/** Status koneksi chamber. */
export function ConnectionBadge({ enabled, connected }) {
  const { t } = useI18n();
  if (!enabled) {
    return <StatusBadge status="__off">{t('Tidak Aktif')}</StatusBadge>;
  }
  if (connected) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        {t('Aktif · Terhubung')}
      </span>
    );
  }
  return <StatusBadge status="__offline">{t('Terputus')}</StatusBadge>;
}
