'use client';

import Link from 'next/link';
import { useI18n } from '@/context/I18nContext';
import DataTable from '@/components/common/DataTable';
import { ConnectionBadge } from '@/components/common/StatusBadge';
import { formatRelative } from '@/lib/utils';
import { EmptyState } from '@/components/common/States';

export default function ChamberTable({ rows }) {
  const { t } = useI18n();
  const columns = [
    { key: 'name', header: 'Chamber', render: (r) => <span className="font-semibold text-slate-900">{r.name}</span> },
    { key: 'status', header: 'Status', render: (r) => <ConnectionBadge enabled={r.enabled} connected={r.connected} /> },
    {
      key: 'sesi',
      header: 'ID Sesi Saat Ini',
      render: (r) => (r.sesiSaatIni ? <span className="font-medium">{r.sesiSaatIni}</span> : <span className="text-slate-400">—</span>),
    },
    { key: 'last', header: 'Pembaruan Terakhir', render: (r) => formatRelative(r.lastSeenAt) },
    {
      key: 'aksi',
      header: 'Aksi',
      className: 'text-right',
      render: (r) => (
        <Link href={`/chambers/${r.chamberId}`} className="font-semibold text-brand-700 hover:underline">
          {t('Lihat Detail')}
        </Link>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey="chamberId"
      empty={<EmptyState title="Chamber tidak ditemukan" description="Belum ada chamber yang terdaftar." />}
    />
  );
}
