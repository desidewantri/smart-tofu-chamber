import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';

export function Loading({ label = 'Memuat data...' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertTriangle className="h-5 w-5" />
      </span>
      <div>
        <p className="font-semibold text-slate-900">Data tidak dapat dimuat</p>
        <p className="mt-1 max-w-md text-sm text-slate-500">{error?.message || 'Terjadi kesalahan.'}</p>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="btn-outline">
          Coba lagi
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Inbox className="h-5 w-5" />
      </span>
      <div>
        <p className="font-semibold text-slate-900">{title}</p>
        {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
