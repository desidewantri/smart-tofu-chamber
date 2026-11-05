'use client';

import { RefreshCw } from 'lucide-react';
import { api } from '@/services/api';
import { useI18n } from '@/context/I18nContext';
import { usePolling } from '@/lib/hooks';
import { formatDateTime, formatTime } from '@/lib/utils';
import { EmptyState, ErrorState, Loading } from '@/components/common/States';
import SampleStatusControl from '@/components/dashboard/SampleStatusControl';
import RslOverview from './RslOverview';
import RslSnapshotTimeline from './RslSnapshotTimeline';

export default function RslModelTab({ chamberId }) {
  const { t } = useI18n();
  const chamberPoll = usePolling(() => api.getChamber(chamberId), 30000, [chamberId]);
  const snapshotPoll = usePolling(() => api.getRslSnapshots(chamberId), 0, [chamberId]);

  const expectedChamber = Number(chamberId);
  const chamberData =
    chamberPoll.data?.chamber?.chamberId === expectedChamber ? chamberPoll.data : null;
  const snapshotData =
    snapshotPoll.data?.chamberId === expectedChamber ? snapshotPoll.data : null;

  if (chamberPoll.error && !chamberData) {
    return <ErrorState error={chamberPoll.error} onRetry={chamberPoll.reload} />;
  }
  // Keep the previous chamber's data out of the new chamber's view while the
  // new request is in flight.
  if (!chamberData) return <Loading />;

  const { chamber, experiment, activeSession, latestReading, rsl } = chamberData;
  const snapshots = snapshotData?.items || [];

  const reload = () => {
    chamberPoll.reload();
    snapshotPoll.reload();
  };

  return (
    <div className="space-y-4">
      <section className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-900">{t('Model RSL')}</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
              {t('M1 adalah hasil utama. M2 (Turnbull) dan M3 (Weibull) adalah estimasi pendukung. Referensi beku hanya DRY; nilai sensor tidak dikirim ke model RSL.')}
            </p>
          </div>
          <button
            type="button"
            onClick={reload}
            className="btn-outline !px-3 !py-1.5 !text-xs"
            aria-label={t('Muat ulang hasil RSL')}
          >
            <RefreshCw className="h-3.5 w-3.5" /> {t('Segarkan')}
          </button>
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-slate-500">{t('Chamber')}</dt>
            <dd className="font-semibold text-slate-800">{chamber?.name || `Chamber ${chamberId}`}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('Eksperimen')}</dt>
            <dd className="font-semibold text-slate-800">{experiment?.label || experiment?.id || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('Mulai eksperimen')}</dt>
            <dd className="font-semibold text-slate-800">{formatDateTime(experiment?.startedAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('Diperbarui')}</dt>
            <dd className="font-semibold text-slate-800">{formatTime(chamberPoll.fetchedAt)}</dd>
          </div>
        </dl>
        {chamberPoll.error && chamberPoll.data && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-600/20">
            {t('Gagal memperbarui hasil RSL')}: {t(chamberPoll.error.message)}. {t('Menampilkan hasil terakhir yang berhasil dimuat.')}
          </p>
        )}
      </section>

      {!activeSession ? (
        <section className="card">
          <EmptyState
            title="Tidak ada eksperimen aktif"
            description="Hasil live muncul setelah eksperimen aktif dan status sampel operator diisi. Snapshot historis tetap dapat dilihat di bawah."
          />
        </section>
      ) : rsl ? (
        <RslOverview
          rsl={rsl}
          session={activeSession}
          latestReading={latestReading}
          chamber={chamber}
        />
      ) : (
        <section className="card">
          <EmptyState
            title="RSL belum tersedia"
            description="Eksperimen aktif, tetapi layanan RSL belum mengembalikan hasil. Tidak ada angka pengganti yang dibuat."
          />
        </section>
      )}

      {activeSession?.experimentId && (
        <SampleStatusControl
          experimentId={activeSession.experimentId}
          sessionId={activeSession.id}
          status={activeSession.sampleStatus}
          onChanged={reload}
        />
      )}

      <RslSnapshotTimeline
        snapshots={snapshots}
        loading={snapshotPoll.loading || !snapshotData}
        error={snapshotPoll.error}
        onRetry={snapshotPoll.reload}
      />
    </div>
  );
}
