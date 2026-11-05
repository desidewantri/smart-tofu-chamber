'use client';

import { useI18n } from '@/context/I18nContext';
import RslHeadline from '@/components/dashboard/RslHeadline';
import RslModelComparison from './RslModelComparison';
import RslReferenceMetadata from './RslReferenceMetadata';
import RslDataQuality from './RslDataQuality';

/**
 * Coherent RSL view: M1 headline, M1/M2/M3 comparison, frozen reference
 * metadata, and measurement/model provenance. This component never calculates
 * or substitutes an estimate.
 */
export default function RslOverview({
  rsl,
  session = null,
  latestReading = null,
  chamber = null,
  snapshot = false,
}) {
  const { t } = useI18n();
  if (!rsl) return null;
  const isSnapshot = snapshot || rsl.isSnapshot;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {isSnapshot ? t('Hasil RSL tersimpan') : t('Hasil RSL live')}
        </p>
        <p className="text-[11px] text-slate-500">
          {isSnapshot
            ? t('Tidak dihitung ulang dari model saat ini.')
            : t('Dihitung dari eksperimen aktif dan status sampel operator.')}
        </p>
      </div>
      <RslHeadline rsl={rsl} />
      <RslModelComparison rsl={rsl} />
      <div className="grid gap-4 lg:grid-cols-2">
        <RslReferenceMetadata rsl={rsl} snapshot={isSnapshot} />
        <RslDataQuality rsl={rsl} session={session} latestReading={latestReading} chamber={chamber} />
      </div>
    </div>
  );
}
