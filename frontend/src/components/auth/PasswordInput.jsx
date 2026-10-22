'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useI18n } from '@/context/I18nContext';

export default function PasswordInput({ id, value, onChange, placeholder, autoComplete = 'current-password', ...rest }) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={show ? 'text' : 'password'} required autoComplete={autoComplete} className="input pr-11"
        placeholder={placeholder} value={value} onChange={onChange} {...rest} />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? t('Sembunyikan kata sandi') : t('Tampilkan kata sandi')}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-600">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
