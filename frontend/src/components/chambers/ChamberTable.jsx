'use client';

import Link from 'next/link';
import DataTable from '@/components/common/DataTable';
import { ConnectionBadge } from '@/components/common/StatusBadge';
import { formatRelative } from '@/lib/utils';
import { EmptyState } from '@/components/common/States';

export default function ChamberTable({ rows }) {
  const columns = [
    { key: 'code', header: 'ID', render: (r) => <span className="font-semibold text-slate-900">{r.code}</span> },
    { key: 'name', header: 'Nama' },
    { key: 'status', header: 'Status', render: (r) => <ConnectionBadge enabled={r.enabled} connected={r.connected} /> },
    {
      key: 'sesi',
      header: 'Sesi Saat Ini',
      render: (r) => (r.sesiSaatIni ? <span className="font-medium">{r.sesiSaatIni}</span> : <span className="text-slate-400">—</span>),
    },
    { key: 'last', header: 'Terakhir Update', render: (r) => formatRelative(r.lastSeenAt) },
    {
      key: 'aksi',
      header: 'Aksi',
      className: 'text-right',
      render: (r) => (
        <Link href={`/chambers/${r.chamberId}`} className="font-semibold text-brand-700 hover:underline">
          Lihat Detail
        </Link>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey="chamberId"
      empty={<EmptyState title="Chamber tidak ditemukan" description="Coba kata kunci lain atau tambahkan chamber baru." />}
    />
  );
}
