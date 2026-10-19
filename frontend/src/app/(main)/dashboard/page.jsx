'use client';

import { RefreshCw } from 'lucide-react';
import { api } from '@/services/api';
import { useI18n } from '@/context/I18nContext';
import { usePolling } from '@/lib/hooks';
import { formatTime } from '@/lib/utils';
import ChamberCard from '@/components/dashboard/ChamberCard';
import IdleChamberCard from '@/components/dashboard/IdleChamberCard';
import { ErrorState, Loading } from '@/components/common/States';

export default function DashboardPage() {
  const { t } = useI18n();
  const { data, error, loading, fetchedAt, reload } = usePolling(() => api.getDashboard(), 10000, []);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  const { active, idle, zones, thresholds, updateIntervalMinutes } = data;
  // Selalu 2 kartu: Chamber 1 dan Chamber 2 (kartu kosong bila belum ada sesi aktif).
  const slots = [
    ...active.map((card) => ({ id: card.chamber.chamberId, card })),
    ...idle.map(({ chamber }) => ({ id: chamber.chamberId, chamber })),
  ].sort((x, y) => x.id - y.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('Chamber Aktif')}</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {t('{n} chamber sedang menyimpan tahu · sensor mengirim data tiap {m} menit', { n: active.length, m: updateIntervalMinutes })}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>{t('Diperbarui')} {formatTime(fetchedAt)}</span>
          <button onClick={reload} className="btn-outline !px-3 !py-2" aria-label={t('Muat ulang')}>
            <RefreshCw className="h-4 w-4" /> {t('Segarkan')}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20">
          {t('Gagal memperbarui data terbaru')}: {t(error.message)}. {t('Menampilkan data terakhir yang berhasil dimuat.')}
        </p>
      )}

      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        {slots.map((slot) =>
          slot.card ? (
            <ChamberCard
              key={slot.id}
              card={slot.card}
              zones={zones}
              thresholds={thresholds}
              fetchedAt={fetchedAt}
              onChanged={reload}
            />
          ) : (
            <IdleChamberCard key={slot.id} chamber={slot.chamber} />
          )
        )}
      </div>
    </div>
  );
}
