import { Cpu } from 'lucide-react';
import { MODEL_LABEL } from '@/lib/utils';

export default function ModelIndicator({ model }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600">
      <Cpu className="h-3.5 w-3.5" />
      Model Aktif: <span className="text-slate-900">{MODEL_LABEL[model] || model || '—'}</span>
    </span>
  );
}
