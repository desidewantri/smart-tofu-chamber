'use client';

import { AlertTriangle, Clock3 } from 'lucide-react';
import { useI18n } from '@/context/I18nContext';
import { getLocale } from '@/lib/locale';
import { formatDateTime, formatRelative } from '@/lib/utils';
import RslStatusPill from './RslStatusPill';

const SAMPLE_STATUS = {
  UNKNOWN: 'Belum diinput',
  NOT_SPOILED: 'Belum rusak',
  SPOILED: 'Dilaporkan rusak',
};

const TIMESTAMP_QUALITY = {
  OK: 'Valid',
  SAMPLE_ID: 'Dari sample_id',
  MISSING: 'Tidak tersedia',
  INVALID: 'Tidak valid',
};

const TIMESTAMP_SOURCE = {
  sampled: 'Waktu sampel perangkat',
  sample_id: 'Sample ID',
  received_at: 'Waktu terima',
  missing: 'Tidak ada',
};

const SOURCE = {
  mqtt: 'MQTT',
  sheet: 'Google Sheets',
  http: 'HTTP',
};

function Row({ label, value, children }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-800">{children !== undefined ? children : value ?? '—'}</dd>
    </div>
  );
}

export default function RslDataQuality({ rsl, session, latestReading, chamber }) {
  const { t } = useI18n();
  const quality = latestReading?.timestampQuality;
  const sources = Array.isArray(latestReading?.sources)
    ? latestReading.sources
    : latestReading?.source
      ? [latestReading.source]
      : [];
  const sourceText = sources.length
    ? sources.map((source) => t(SOURCE[source] || source)).join(' + ')
    : null;

  return (
    <section className="card p-4 sm:p-5">
      <h3 className="flex items-center gap-2 font-semibold text-slate-900">
        <Clock3 className="h-4 w-4 text-brand-700" /> {t('Kualitas data & provenance')}
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        {t('Waktu sampel, waktu terima server, dan waktu perhitungan model ditampilkan terpisah.')}
      </p>

      <dl className="mt-3 divide-y divide-slate-100 text-xs">
        <Row label={t('Status sampel')} value={t(SAMPLE_STATUS[session?.sampleStatus] || SAMPLE_STATUS.UNKNOWN)} />
        <Row label={t('Kondisi penyimpanan')} value={session?.storageCondition || rsl?.storageCondition} />
        <Row
          label={t('Waktu berjalan')}
          value={
            rsl?.elapsedHours === null || rsl?.elapsedHours === undefined
              ? '—'
              : `${Number(rsl.elapsedHours).toLocaleString(getLocale(), {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })} ${t('jam')}`
          }
        />
        <Row label={t('Status model')}>
          <RslStatusPill status={rsl?.status || 'NOT_AVAILABLE'} />
        </Row>
        {rsl?.reason && <Row label={t('Alasan')} value={rsl.message || rsl.reason} />}
        <Row label={t('Jumlah pembacaan')} value={session?.readingCount ?? '—'} />
        {chamber && (
          <Row
            label={t('Koneksi chamber')}
            value={chamber.connected ? t('Terhubung') : t('Terputus')}
          />
        )}
        {latestReading && (
          <>
            <Row label={t('Waktu pengukuran')} value={formatDateTime(latestReading.sampledAt)} />
            <Row label={t('Waktu diterima server')} value={formatDateTime(latestReading.receivedAt)} />
            <Row label={t('Kualitas waktu')} value={t(TIMESTAMP_QUALITY[quality] || quality)} />
            <Row label={t('Sumber waktu')} value={t(TIMESTAMP_SOURCE[latestReading.timestampSource] || latestReading.timestampSource)} />
            <Row label={t('Sumber data')} value={sourceText} />
            <Row label={t('Umur data')} value={formatRelative(latestReading.receivedAt || latestReading.sampledAt)} />
          </>
        )}
        <Row
          label={rsl?.isSnapshot ? t('Waktu snapshot') : t('Dihitung')}
          value={formatDateTime(rsl?.generatedAt || rsl?.snapshotAt)}
        />
      </dl>

      {!latestReading && (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600 ring-1 ring-inset ring-slate-200/70">
          {t('Belum ada pembacaan sensor. Nilai sensor tidak dibuat atau diinterpolasi.')}
        </p>
      )}

      {latestReading && (quality === 'MISSING' || quality === 'INVALID') && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] leading-snug text-amber-800 ring-1 ring-inset ring-amber-600/20">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {quality === 'MISSING'
              ? t('Waktu pengukuran tidak tersedia; waktu terima tidak dipakai sebagai waktu ukur.')
              : t('Waktu pengukuran tidak valid; waktu terima tidak dipakai sebagai waktu ukur.')}
          </span>
        </p>
      )}
    </section>
  );
}
