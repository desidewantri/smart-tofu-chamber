'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '@/services/api';
import { usePolling, useDebounced } from '@/lib/hooks';
import HistoryTable from '@/components/history/HistoryTable';
import Pagination from '@/components/common/Pagination';
import { ErrorState, Loading } from '@/components/common/States';

const STATUS_OPTIONS = [
  { value: '', label: 'Semua Status' },
  { value: 'aktif', label: 'Berjalan' },
  { value: 'Layak Jual', label: 'Layak Jual' },
  { value: 'Segera Jual', label: 'Segera Jual' },
  { value: 'Tidak Layak Jual', label: 'Tidak Layak Jual' },
];

export default function HistoryPage() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [chamberId, setChamberId] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  const { data: chambers } = usePolling(() => api.getChambers(), 0, []);
  const chambersByNo = useMemo(
    () => Object.fromEntries((chambers || []).map((c) => [c.chamberId, c.code])),
    [chambers]
  );

  useEffect(() => setPage(1), [dq, chamberId, status, from, to, limit]);

  const { data, error, loading, reload } = usePolling(
    () =>
      api.getSessions({
        q: dq,
        chamberId,
        status: status === 'aktif' ? 'aktif' : undefined,
        statusAkhir: status && status !== 'aktif' ? status : undefined,
        from,
        to,
        sort: 'masuk',
        page,
        limit,
      }),
    0,
    [dq, chamberId, status, from, to, page, limit]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Riwayat Sesi</h2>
        <p className="mt-1 text-sm text-slate-500">Setiap sesi mewakili satu batch tahu di dalam chamber.</p>
      </div>

      <div className="card overflow-hidden">
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input !pl-10" placeholder="Cari Session ID…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input" value={chamberId} onChange={(e) => setChamberId(e.target.value)} aria-label="Filter chamber">
            <option value="">Semua Chamber</option>
            {(chambers || []).map((c) => <option key={c.chamberId} value={c.chamberId}>{c.code}</option>)}
          </select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="Dari tanggal" />
          <input type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="Sampai tanggal" />
        </div>

        {loading && !data ? (
          <Loading />
        ) : error && !data ? (
          <div className="p-4"><ErrorState error={error} onRetry={reload} /></div>
        ) : (
          <>
            <HistoryTable rows={data.items} chambersByNo={chambersByNo} />
            <Pagination page={data.page} pages={data.pages} total={data.total} limit={data.limit} onPage={setPage} onLimit={setLimit} />
          </>
        )}
      </div>
    </div>
  );
}
