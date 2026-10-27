'use client';

import { cn } from '@/lib/utils';

export function SettingsCard({ title, description, children, onSave, saving, saveLabel = 'Simpan', disabled }) {
  return (
    <section className="card p-5 sm:p-6">
      <h3 className="font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      <div className="mt-5 space-y-4">{children}</div>
      {onSave && (
        <div className="mt-6 flex justify-end">
          <button className="btn-primary" onClick={onSave} disabled={saving || disabled}>
            {saving ? 'Menyimpan…' : saveLabel}
          </button>
        </div>
      )}
    </section>
  );
}

export function NumberField({ label, hint, value, onChange, unit, step = 1, min }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <input
          type="number"
          className={cn('input', unit && 'pr-14')}
          value={value}
          step={step}
          min={min}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
        {unit && <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-slate-400">{unit}</span>}
      </div>
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div>
        <p className="text-sm font-medium text-slate-900">{label}</p>
        {description && <p className="text-xs text-slate-500">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-brand-600' : 'bg-slate-300')}
      >
        <span className={cn('absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition', checked && 'translate-x-5')} />
      </button>
    </div>
  );
}
