'use client';

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/services/api';
import { useI18n } from '@/context/I18nContext';
import { usePolling } from '@/lib/hooks';
import { PERIOD_OPTIONS } from '@/lib/utils';
import Tabs from '@/components/common/Tabs';
import { EmptyState, ErrorState, Loading } from '@/components/common/States';
import ConditionAnalysisTab from '@/components/analysis/ConditionAnalysisTab';
import CostBenefitTab from '@/components/analysis/CostBenefitTab';
import SeasonalAnalysisTab from '@/components/analysis/SeasonalAnalysisTab';
import RslModelTab from '@/components/rsl/RslModelTab';

const TABS = [
  { id: 'kondisi', label: 'Analisis Kondisi' },
  { id: 'rsl', label: 'Model RSL' },
  { id: 'biaya', label: 'Biaya dan Manfaat' },
  { id: 'musiman', label: 'Analisis Musiman' },
];

function AnalysisInner() {
  const { t } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = params.toString();
  const { data: chambers, error, loading, reload } = usePolling(() => api.getChambers(), 0, []);
  const [chamberId, setChamberId] = useState(params.get('chamber') || '');
  const [period, setPeriod] = useState('24h');
  const [tab, setTab] = useState(params.get('tab') || 'kondisi');

  // pilih chamber awal: dari URL, atau chamber dengan sesi aktif, atau yang pertama
  useEffect(() => {
    if (chamberId || !chambers?.length) return;
    const pick = chambers.find((c) => c.sesiSaatIni) || chambers[0];
    setChamberId(String(pick.chamberId));
  }, [chambers, chamberId]);

  // periode bawaan menyesuaikan tab
  useEffect(() => {
    setPeriod(tab === 'kondisi' || tab === 'rsl' ? '24h' : tab === 'biaya' ? '30d' : '365d');
  }, [tab]);

  // RSL selalu per chamber; never pass the "all" sentinel to the RSL API.
  useEffect(() => {
    if (tab === 'rsl' && chamberId === 'all' && chambers?.length) {
      setChamberId(String(chambers[0].chamberId));
    }
  }, [tab, chamberId, chambers]);

  // Keep tab/chamber deep-linkable so refresh and back/forward preserve state.
  useEffect(() => {
    const next = new URLSearchParams(query);
    if (chamberId) next.set('chamber', chamberId);
    else next.delete('chamber');
    next.set('tab', tab);
    const qs = next.toString();
    const target = qs ? `${pathname}?${qs}` : pathname;
    if (`${pathname}?${query}` !== target) router.replace(target, { scroll: false });
  }, [tab, chamberId, pathname, query, router]);

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
            {(tab !== 'kondisi' && tab !== 'rsl') && <option value="all">{t('Semua Chamber')}</option>}
            {chambers.map((c) => (
              <option key={c.chamberId} value={c.chamberId}>{c.name}</option>
            ))}
          </select>
        </div>
        {tab !== 'rsl' ? (
          <div>
            <label htmlFor="period" className="label">{t('Pilih Periode')}</label>
            <select id="period" className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {periods.map((p) => <option key={p.value} value={p.value}>{t(p.label)}</option>)}
            </select>
          </div>
        ) : (
          <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs leading-relaxed text-slate-600 ring-1 ring-inset ring-slate-200/70">
            {t('Model RSL memakai waktu berjalan eksperimen, status sampel operator, dan referensi DRY — bukan periode grafik sensor.')}
          </div>
        )}
      </div>

      <Tabs tabs={TABS} active={tab} onChange={(t) => { setTab(t); if ((t === 'kondisi' || t === 'rsl') && chamberId === 'all') setChamberId(String(chambers[0].chamberId)); }} />

      {chamberId && (
        <div key={`${tab}-${chamberId}-${period}`} className="animate-fade-in">
          {tab === 'kondisi' && <ConditionAnalysisTab chamberId={chamberId} period={period} />}
          {tab === 'rsl' && <RslModelTab chamberId={chamberId} />}
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
