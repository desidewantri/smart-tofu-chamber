'use client';

import { AlertTriangle, BookOpenCheck } from 'lucide-react';
import { useI18n } from '@/context/I18nContext';

const CAVEAT_TEXT = {
  POST_HOC_EXPLORATORY: 'Post hoc eksploratif; bukan uji konfirmatori.',
  DESCRIPTIVE: 'Deskriptif; bukan prediksi individual.',
  THREE_INFORMATIVE_DRY_ENDPOINTS: 'Hanya tiga endpoint kering (S3/S4/S5).',
  BATCH_INDEPENDENCE_UNVERIFIED: 'Independensi batch belum diverifikasi.',
  TIME_ORIGIN_IS_FIRST_SENSOR_TIMESTAMP:
    'Referensi historis memakai timestamp sensor pertama; aplikasi memakai Experiment.startedAt.',
  NOT_A_PROBABILISTIC_PREDICTION_INTERVAL:
    'Bukan interval prediksi atau interval kepercayaan probabilistik.',
  TVOC_CONTRIBUTION_NOT_ESTABLISHED: 'Kontribusi TVOC belum ditetapkan.',
};

const RESEARCH_STATUS = {
  POST_HOC_EXPLORATORY_DESCRIPTIVE: 'Post hoc eksploratif & deskriptif',
};

const ELAPSED_ORIGIN = {
  EXPERIMENT_STARTED_AT: 'Experiment.startedAt',
  FIRST_SENSOR_TIMESTAMP: 'Timestamp sensor pertama',
};

const TVOC_CONTRIBUTION = {
  NOT_ESTABLISHED: 'Tidak ditetapkan',
};

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-800">{value || '—'}</dd>
    </div>
  );
}

export default function RslReferenceMetadata({ rsl, snapshot = false }) {
  const { t } = useI18n();
  const metadata = rsl?.metadata;

  if (!metadata) {
    return (
      <section className="card p-4 sm:p-5">
        <h3 className="flex items-center gap-2 font-semibold text-slate-900">
          <BookOpenCheck className="h-4 w-4 text-brand-700" /> {t('Metadata referensi')}
        </h3>
        <p className="mt-2 text-sm text-slate-500">{t('Metadata referensi tidak tersedia.')}</p>
      </section>
    );
  }

  const caveats = Array.isArray(metadata.caveats) ? metadata.caveats : [];

  return (
    <section className="card p-4 sm:p-5">
      <h3 className="flex items-center gap-2 font-semibold text-slate-900">
        <BookOpenCheck className="h-4 w-4 text-brand-700" /> {t('Metadata referensi')}
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        {t('Nilai yang benar-benar dikembalikan oleh layanan RSL; tidak ada nilai bawaan yang diisi di browser.')}
      </p>

      <dl className="mt-3 divide-y divide-slate-100 text-xs">
        <Row label={t('Versi engine')} value={metadata.engineVersion} />
        <Row label={t('Versi referensi')} value={metadata.referenceVersion} />
        <Row
          label={t('Populasi referensi')}
          value={
            metadata.referencePopulation !== null && metadata.referencePopulation !== undefined
              ? t('{n} sesi kering (S3/S4/S5)', { n: metadata.referencePopulation })
              : null
          }
        />
        <Row label={t('Kondisi referensi')} value={metadata.referenceStorageCondition} />
        <Row label={t('Kondisi sesi')} value={rsl.storageCondition} />
        <Row
          label={t('Asal waktu')}
          value={ELAPSED_ORIGIN[metadata.elapsedOrigin] || metadata.elapsedOrigin}
        />
        <Row
          label={t('Kontribusi TVOC')}
          value={TVOC_CONTRIBUTION[metadata.tvocContribution] || metadata.tvocContribution}
        />
      </dl>

      <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] leading-snug text-amber-800 ring-1 ring-inset ring-amber-600/20">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p>
          {t('Referensi beku hanya DRY (S3/S4/S5). Hasil tidak berlaku untuk WATER/UNKNOWN, bukan jaminan individual, dan bukan waktu kedaluwarsa yang pasti.')}
        </p>
      </div>

      <details className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600 ring-1 ring-inset ring-slate-200/70">
        <summary className="cursor-pointer font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40">
          {t('Catatan metodologi')}
        </summary>
        <p className="mt-2">
          {t('Status riset')}: {RESEARCH_STATUS[metadata.researchStatus] || metadata.researchStatus || '—'}
        </p>
        {caveats.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {caveats.map((code) => (
              <li key={code}>
                <span className="font-medium text-slate-700">{t(CAVEAT_TEXT[code] || code)}</span>
                {CAVEAT_TEXT[code] && (
                  <span className="ml-1 text-[10px] text-slate-400">({code})</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-500">{t('Tidak ada catatan metodologi tambahan.')}</p>
        )}
      </details>
    </section>
  );
}
