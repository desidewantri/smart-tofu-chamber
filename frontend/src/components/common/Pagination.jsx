import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

function pageList(page, pages) {
  const set = new Set([1, pages, page, page - 1, page + 1]);
  const list = [...set].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const out = [];
  list.forEach((p, i) => {
    if (i > 0 && p - list[i - 1] > 1) out.push('…');
    out.push(p);
  });
  return out;
}

export default function Pagination({ page, pages, total, limit, onPage, onLimit }) {
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 text-sm text-slate-500 sm:flex-row">
      <span>
        Menampilkan {from}–{to} dari {total} data
      </span>
      <div className="flex items-center gap-2">
        <button className="btn-outline !px-2.5 !py-1.5" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Sebelumnya">
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pageList(page, pages).map((p, i) =>
          p === '…' ? (
            <span key={`gap${i}`} className="px-1">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p)}
              className={cn(
                'h-8 min-w-8 rounded-lg px-2 text-sm font-medium transition',
                p === page ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              {p}
            </button>
          )
        )}
        <button className="btn-outline !px-2.5 !py-1.5" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Berikutnya">
          <ChevronRight className="h-4 w-4" />
        </button>
        <select className="input !w-auto !py-1.5" value={limit} onChange={(e) => onLimit(Number(e.target.value))}>
          {[5, 10, 20, 50].map((n) => (
            <option key={n} value={n}>
              {n} / halaman
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
