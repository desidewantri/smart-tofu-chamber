'use client';

import Link from 'next/link';
import DataTable from '@/components/common/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { EmptyState } from '@/components/common/States';
import { formatDateTime, formatDurationShort } from '@/lib/utils';

export default function HistoryTable({ rows, chambersByNo }) {
  const columns = [
    { key: 'sesiCode', header: 'Session ID', render: (r) => <span className="font-semibold text-slate-900">{r.sesiCode}</span> },
    { key: 'chamber', header: 'Chamber', render: (r) => chambersByNo[r.chamberId] || `CH-${String(r.chamberId).padStart(3, '0')}` },
    { key: 'masuk', header: 'Waktu Mulai', render: (r) => formatDateTime(r.masuk) },
    { key: 'selesai', header: 'Waktu Selesai', render: (r) => (r.selesai ? formatDateTime(r.selesai) : <span className="text-slate-400">Berjalan</span>) },
    { key: 'durasi', header: 'Durasi', render: (r) => formatDurationShort(r.durasiDetik) },
    {
      key: 'status',
      header: 'Status Akhir',
      render: (r) =>
        r.status === 'aktif' ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 ring-1 ring-inset ring-sky-600/20">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" /> Berjalan
          </span>
        ) : (
          <StatusBadge status={r.statusAkhir} />
        ),
    },
    {
      key: 'aksi',
      header: 'Aksi',
      className: 'text-right',
      render: (r) => (
        <Link href={`/history/${r.sesiCode}`} className="font-semibold text-brand-700 hover:underline">
          Lihat Detail
        </Link>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      empty={<EmptyState title="Tidak ada sesi" description="Ubah filter atau rentang tanggal untuk melihat sesi lain." />}
    />
  );
}
