'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/services/api';
import { useI18n } from '@/context/I18nContext';
import { usePolling } from '@/lib/hooks';
import { PERIOD_OPTIONS } from '@/lib/utils';
import Tabs from '@/components/common/Tabs';
import { EmptyState, ErrorState, Loading } from '@/components/common/States';
import ConditionAnalysisTab from '@/components/analysis/ConditionAnalysisTab';
import CostBenefitTab from '@/components/analysis/CostBenefitTab';
import SeasonalAnalysisTab from '@/components/analysis/SeasonalAnalysisTab';

const TABS = [
  { id: 'kondisi', label: 'Analisis Kondisi' },
  { id: 'biaya', label: 'Biaya dan Manfaat' },
  { id: 'musiman', label: 'Analisis Musiman' },
];

function AnalysisInner() {
  const { t } = useI18n();
  const params = useSearchParams();
  const { data: chambers, error, loading, reload } = usePolling(() => api.getChambers(), 0, []);
  const [chamberId, setChamberId] = useState(params.get('chamber') || '');
  const [period, setPeriod] = useState('24h');
  const [tab, setTab] = useState('kondisi');

  // pilih chamber awal: dari URL, atau chamber dengan sesi aktif, atau yang pertama
  useEffect(() => {
    if (chamberId || !chambers?.length) return;
    const pick = chambers.find((c) => c.sesiSaatIni) || chambers[0];
    setChamberId(String(pick.chamberId));
  }, [chambers, chamberId]);

  // periode bawaan menyesuaikan tab
  useEffect(() => {
    setPeriod(tab === 'kondisi' ? '24h' : tab === 'biaya' ? '30d' : '365d');
  }, [tab]);

  if (loading && !chambers) return <Loading />;
  if (error && !chambers) return <ErrorState error={error} onRetry={reload} />;
  if (!chambers?.length) return <div className="card"><EmptyState title="Belum ada chamber" description="Tambahkan chamber di halaman Chamber." /></div>;

  const periods = tab === 'kondisi' ? PERIOD_OPTIONS.slice(0, 3) : tab === 'biaya' ? PERIOD_OPTIONS.slice(2) : PERIOD_OPTIONS.slice(3);

  return (
    <div className="space-y-6">
      <div className="card grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
        <div>
          <label htmlFor="chamber" className="label">{t('Pilih Chamber')}</label>
          <select id="chamber" className="input" value={chamberId} onChange={(e) => setChamberId(e.target.value)}>
            {tab !== 'kondisi' && <option value="all">{t('Semua Chamber')}</option>}
            {chambers.map((c) => (
              <option key={c.chamberId} value={c.chamberId}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="period" className="label">{t('Pilih Periode')}</label>
          <select id="period" className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {periods.map((p) => <option key={p.value} value={p.value}>{t(p.label)}</option>)}
          </select>
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={(t) => { setTab(t); if (t === 'kondisi' && chamberId === 'all') setChamberId(String(chambers[0].chamberId)); }} />

      {chamberId && (
        <div key={`${tab}-${chamberId}-${period}`} className="animate-fade-in">
          {tab === 'kondisi' && <ConditionAnalysisTab chamberId={chamberId} period={period} />}
          {tab === 'biaya' && <CostBenefitTab chamberId={chamberId === 'all' ? '' : chamberId} period={period} />}
          {tab === 'musiman' && <SeasonalAnalysisTab chamberId={chamberId === 'all' ? '' : chamberId} period={period} />}
        </div>
      )}
    </div>
  );
}

export default function AnalysisPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AnalysisInner />
    </Suspense>
  );
}
