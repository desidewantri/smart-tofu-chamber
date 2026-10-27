import { cn } from '@/lib/utils';
import { EmptyState } from './States';

/**
 * columns: [{ key, header, className?, render?(row) }]
 */
export default function DataTable({ columns, rows, rowKey = 'id', empty }) {
  if (!rows || rows.length === 0) {
    return empty || <EmptyState title="Tidak ada data" />;
  }
  return (
    <div className="thin-scroll overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
            {columns.map((c) => (
              <th key={c.key} className={cn('whitespace-nowrap px-5 py-3.5 font-semibold', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row[rowKey]} className="transition hover:bg-slate-50/70">
              {columns.map((c) => (
                <td key={c.key} className={cn('whitespace-nowrap px-5 py-4 text-slate-700', c.className)}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
