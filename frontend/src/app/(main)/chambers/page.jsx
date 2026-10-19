'use client';

import { api } from '@/services/api';
import { useI18n } from '@/context/I18nContext';
import { usePolling } from '@/lib/hooks';
import ChamberTable from '@/components/chambers/ChamberTable';
import { ErrorState, Loading } from '@/components/common/States';

export default function ChambersPage() {
  const { data, error, loading, reload } = usePolling(() => api.getChambers(''), 15000, []);
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">{t('Daftar Chamber')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('Sistem memiliki 2 chamber (2 kelompok sensor). Setiap sesi penyimpanan dibedakan oleh ID sesi: CH-001, CH-002, dan seterusnya.')}</p>
      </div>

      <div className="card overflow-hidden">
        {loading && !data ? <Loading /> : error && !data ? <div className="p-4"><ErrorState error={error} onRetry={reload} /></div> : <ChamberTable rows={data} />}
      </div>
    </div>
  );
}
