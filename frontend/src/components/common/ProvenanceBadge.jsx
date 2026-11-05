'use client';

import { useI18n } from '@/context/I18nContext';
import { formatDateTime } from '@/lib/utils';

function sourceLabel(sources, t) {
  if (!sources || !sources.length) return t('Sumber tidak tercatat');
  const labels = sources.map((s) => {
    if (s === 'mqtt') return 'MQTT';
    if (s === 'sheet') return 'Google Sheets';
    if (s === 'http') return 'HTTP';
    return String(s);
  });
  return labels.join(' + ');
}

/**
 * Compact provenance label for a sensor reading. Keeps detailed timestamps in
 * title attributes so the dashboard stays readable.
 */
export default function ProvenanceBadge({ reading, className = '' }) {
  const { t } = useI18n();
  if (!reading) return null;

  const sources = Array.isArray(reading.sources)
    ? reading.sources
    : reading.source
      ? [reading.source]
      : [];
  const quality = reading.timestampQuality;
  const sampled = reading.sampledAt ? formatDateTime(reading.sampledAt) : null;
  const received = reading.receivedAt ? formatDateTime(reading.receivedAt) : null;
  const measurement = sampled || (quality === 'MISSING' ? null : formatDateTime(reading.timestamp));

  const titleParts = [];
  if (reading.sampledAt) titleParts.push(`${t('Waktu pengukuran perangkat')}: ${sampled}`);
  if (reading.receivedAt) titleParts.push(`${t('Waktu diterima server')}: ${received}`);
  if (quality === 'SAMPLE_ID') titleParts.push(t('Waktu pengukuran diturunkan dari sample_id'));
  if (quality === 'MISSING') titleParts.push(t('Waktu pengukuran tidak tersedia'));
  if (quality === 'INVALID') titleParts.push(t('Waktu pengukuran tidak valid'));

  return (
    <p
      className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500 ${className}`}
      title={titleParts.join(' · ') || undefined}
    >
      <span className="font-semibold text-slate-600">{sourceLabel(sources, t)}</span>
      {measurement ? <span aria-hidden="true">·</span> : null}
      {measurement ? <span>{measurement}</span> : null}
      {quality === 'MISSING' || quality === 'INVALID' ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="font-medium text-amber-700">{t('Waktu pengukuran tidak tersedia')}</span>
        </>
      ) : null}
    </p>
  );
}
