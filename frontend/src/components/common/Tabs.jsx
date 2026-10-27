'use client';

import { cn } from '@/lib/utils';

/** tabs: [{ id, label }] */
export default function Tabs({ tabs, active, onChange }) {
  return (
    <div className="thin-scroll flex gap-1 overflow-x-auto rounded-xl bg-slate-100/80 p-1" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition',
            active === t.id ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
