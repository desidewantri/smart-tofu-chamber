'use client';

import { AlertTriangle, BookOpenCheck, ShieldQuestion } from 'lucide-react';
import { useI18n } from '@/context/I18nContext';
import { cn, formatDateTime } from '@/lib/utils';

const REASON_TEXT = {
  SAMPLE_STATUS_UNKNOWN: 'Belum diverifikasi',
  SAMPLE_REPORTED_SPOILED: 'Sampel dilaporkan rusak',
  UNSUPPORTED_STORAGE_CONDITION: 'Kondisi penyimpanan tidak didukung',
  OUTSIDE_REFERENCE_SUPPORT: 'Di luar dukungan referensi historis',
  NEGATIVE_ELAPSED_TIME: 'Waktu eksperimen tidak valid',
  EXPERIMENT_CLOSED: 'Eksperimen sudah selesai',
  NO_ACTIVE_SESSION: 'Sesi chamber tidak aktif',
  NO_ACTIVE_EXPERIMENT: 'Tidak ada eksperimen aktif',
  RSL_TIMEOUT: 'Layanan estimasi timeout',
  RSL_UNAVAILABLE: 'Layanan estimasi tidak tersedia',
  RSL_DISABLED: 'Layanan estimasi dinonaktifkan',
  ENGINE_UNAVAILABLE: 'Layanan estimasi tidak tersedia',
  ENGINE_INVALID_RESPONSE: 'Respons estimasi tidak valid',
};

const REASON_DETAIL = {
  SAMPLE_STATUS_UNKNOWN: 'Sampel belum diverifikasi operator. Gunakan “Catat kondisi sampel” untuk mencatat hasil observasi fisik bila tersedia.',
  SAMPLE_REPORTED_SPOILED: 'Tidak ada rentang sisa umur yang ditampilkan untuk sampel yang dilaporkan rusak.',
  UNSUPPORTED_STORAGE_CONDITION: 'Referensi beku hanya tersedia untuk penyimpanan kering (DRY).',
  OUTSIDE_REFERENCE_SUPPORT: 'Waktu berjalan sudah melewati seluruh batas atas referensi historis.',
  RSL_TIMEOUT: 'Permintaan tidak diulang otomatis; muat ulang halaman setelah layanan pulih.',
  RSL_UNAVAILABLE: 'Periksa layanan RSL lokal. Tidak ada angka pengganti yang dibuat.',
};

function fmt(value, digits = 2) {
  return Number(value).toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export default function RslHeadline({ rsl, className = '' }) {
  const { t } = useI18n();
  if (!rsl) return null;

  if (rsl.status === 'AVAILABLE' && rsl.primary) {
    const { display, lowerHours, upperHours, nReferenceSessions } = rsl.primary;
    return (
      <div className={cn('rounded-xl bg-white/85 px-3.5 py-2.5 ring-1 ring-inset ring-slate-200/80', className)}>
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <BookOpenCheck className="h-3.5 w-3.5" /> {`M1 · ${t('Rentang historis tersisa')}`}
        </p>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-1.5 font-bold tabular-nums text-brand-900">
          <span className="text-[32px] leading-none">{display.lowerHours}–{display.upperHours}</span>
          <span className="text-sm font-semibold text-slate-500">{t('jam lagi')}</span>
        </p>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          {t('Batas penuh')}: {fmt(lowerHours)}–{fmt(upperHours)} {t('jam')} · {t('berbasis {n} sesi referensi kering', { n: nReferenceSessions })}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          {t('Ini rentang historis, bukan interval kepercayaan dan bukan jaminan keamanan individu.')}
        </p>
        {(rsl.metadata?.referenceVersion || rsl.generatedAt || rsl.snapshotAt) && (
          <p className="mt-1 text-[11px] text-slate-500">
            {[
              rsl.metadata?.referenceVersion ? `${t('Referensi')} ${rsl.metadata.referenceVersion}` : null,
              rsl.metadata?.referenceStorageCondition || null,
              rsl.generatedAt || rsl.snapshotAt
                ? `${rsl.isSnapshot ? t('snapshot') : t('dihitung')} ${formatDateTime(rsl.generatedAt || rsl.snapshotAt)}`
                : null,
            ].filter(Boolean).join(' · ')}
          </p>
        )}
        <p className="mt-1 text-[11px] font-medium text-slate-600">
          {t('Waktu berjalan')}: {fmt(rsl.elapsedHours, 2)} {t('jam sejak eksperimen dimulai')}
        </p>
      </div>
    );
  }

  if (rsl.status === 'REFERENCE_ONLY' && rsl.primary) {
    const { display, lowerHours, upperHours, nReferenceSessions } = rsl.primary;
    return (
      <div className={cn('rounded-xl bg-white/85 px-3.5 py-2.5 ring-1 ring-inset ring-slate-200/80', className)}>
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <BookOpenCheck className="h-3.5 w-3.5" /> {`M1 · ${t('Referensi historis')}`}
        </p>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-1.5 font-bold tabular-nums text-brand-900">
          <span className="text-[32px] leading-none">{display.lowerHours}–{display.upperHours}</span>
          <span className="text-sm font-semibold text-slate-500">{t('jam')}</span>
        </p>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          {t('Batas penuh')}: {fmt(lowerHours)}–{fmt(upperHours)} {t('jam')} · {t('berbasis {n} sesi referensi kering', { n: nReferenceSessions })}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-amber-700">
          {t('Sampel belum diverifikasi operator. Ini referensi historis bersama, bukan prediksi individual dan bukan kondisi sampel yang dikonfirmasi.')}
        </p>
        {(rsl.metadata?.referenceVersion || rsl.generatedAt || rsl.snapshotAt) && (
          <p className="mt-1 text-[11px] text-slate-500">
            {[
              rsl.metadata?.referenceVersion ? `${t('Referensi')} ${rsl.metadata.referenceVersion}` : null,
              rsl.metadata?.referenceStorageCondition || null,
              rsl.generatedAt || rsl.snapshotAt
                ? `${t('dihitung')} ${formatDateTime(rsl.generatedAt || rsl.snapshotAt)}`
                : null,
            ].filter(Boolean).join(' · ')}
          </p>
        )}
        <p className="mt-1 text-[11px] font-medium text-slate-600">
          {t('Waktu berjalan')}: {fmt(rsl.elapsedHours, 2)} {t('jam sejak eksperimen dimulai')}
        </p>
      </div>
    );
  }

  const reason = rsl.reason || 'ENGINE_UNAVAILABLE';
  const isUnknown = reason === 'SAMPLE_STATUS_UNKNOWN';
  const isSpoiled = reason === 'SAMPLE_REPORTED_SPOILED';
  const Icon = isSpoiled ? AlertTriangle : isUnknown ? ShieldQuestion : AlertTriangle;
  return (
    <div className={cn('rounded-xl bg-white/85 px-3.5 py-2.5 ring-1 ring-inset ring-slate-200/80', className)}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <Icon className="h-3.5 w-3.5" /> {`M1 · ${t('Perkiraan Sisa Umur Tahu')}`}
      </p>
      <p className={cn('mt-0.5 text-lg font-bold', isSpoiled ? 'text-red-700' : 'text-slate-700')}>
        {t(REASON_TEXT[reason] || 'Estimasi tidak tersedia')}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
        {t(REASON_DETAIL[reason] || 'Tidak ada angka estimasi yang dibuat untuk kondisi ini.')}
      </p>
      {(rsl.metadata?.referenceVersion || rsl.generatedAt || rsl.snapshotAt) && (
        <p className="mt-1 text-[11px] text-slate-500">
          {[
            rsl.metadata?.referenceVersion ? `${t('Referensi')} ${rsl.metadata.referenceVersion}` : null,
            rsl.metadata?.referenceStorageCondition || null,
            rsl.generatedAt || rsl.snapshotAt
              ? `${rsl.isSnapshot ? t('snapshot') : t('dihitung')} ${formatDateTime(rsl.generatedAt || rsl.snapshotAt)}`
              : null,
          ].filter(Boolean).join(' · ')}
        </p>
      )}
      {rsl.elapsedHours !== null && rsl.elapsedHours !== undefined && (
        <p className="mt-1 text-[11px] font-medium text-slate-600">
          {t('Waktu berjalan')}: {fmt(rsl.elapsedHours, 2)} {t('jam sejak eksperimen dimulai')}
        </p>
      )}
    </div>
  );
}
