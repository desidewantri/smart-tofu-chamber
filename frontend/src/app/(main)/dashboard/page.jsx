'use client';

import Link from 'next/link';
import { RefreshCw, Boxes } from 'lucide-react';
import { api } from '@/services/api';
import { usePolling } from '@/lib/hooks';
import { formatTime, formatRelative } from '@/lib/utils';
import ChamberCard from '@/components/dashboard/ChamberCard';
import { EmptyState, ErrorState, Loading } from '@/components/common/States';
import { ConnectionBadge } from '@/components/common/StatusBadge';

export default function DashboardPage() {
  const { data, error, loading, fetchedAt, reload } = usePolling(() => api.getDashboard(), 10000, []);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  const { active, idle, zones, thresholds, updateIntervalMinutes } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Chambers Aktif</h2>
          <p className="mt-1 text-sm text-slate-500">
            {active.length} chamber sedang menyimpan tahu · sensor mengirim data tiap {updateIntervalMinutes} menit
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>Diperbarui {formatTime(fetchedAt)}</span>
          <button onClick={reload} className="btn-outline !px-3 !py-2" aria-label="Muat ulang">
            <RefreshCw className="h-4 w-4" /> Segarkan
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20">
          Gagal memperbarui data terbaru: {error.message}. Menampilkan data terakhir yang berhasil dimuat.
        </p>
      )}

      {active.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Belum ada sesi aktif"
            description="Sesi dibuat otomatis saat sensor chamber mengirim data pertama. Jalankan simulator atau hubungkan perangkat ESP32."
          />
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {active.map((card) => (
            <ChamberCard
              key={card.chamber.chamberId}
              card={card}
              zones={zones}
              thresholds={thresholds}
              fetchedAt={fetchedAt}
              onChanged={reload}
            />
          ))}
        </div>
      )}

      {idle.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Chamber tanpa sesi aktif</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {idle.map(({ chamber }) => (
              <Link key={chamber.chamberId} href={`/chambers/${chamber.chamberId}`} className="card flex flex-col gap-3 p-4 transition hover:border-brand-600/40">
                <span className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                    <Boxes className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">{chamber.name}</span>
                    <span className="block truncate text-xs text-slate-500">{chamber.code} · {formatRelative(chamber.lastSeenAt)}</span>
                  </span>
                </span>
                <ConnectionBadge enabled={chamber.enabled} connected={chamber.connected} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
