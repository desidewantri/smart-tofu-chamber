import { cn } from '@/lib/utils';

/** Ikon logo: kubus tahu dengan tetes sensor. Gambar asli buatan sendiri. */
export function LogoMark({ className = 'h-10 w-10', rounded = 'rounded-xl', variant = 'solid' }) {
  const light = variant === 'light';
  const cube = light ? '#16a34a' : '#ffffff';
  const edge = light ? '#ffffff' : '#16a34a';
  return (
    <span className={cn('inline-flex items-center justify-center shadow-sm', light ? 'bg-white' : 'bg-brand-600', rounded, className)}>
      <svg viewBox="0 0 32 32" className="h-3/5 w-3/5" fill="none" aria-hidden="true">
        <path d="M16 4 6 9.5v11L16 26l10-5.5v-11L16 4Z" fill={cube} />
        <path d="M6 9.5 16 15l10-5.5M16 15v11" stroke={edge} strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="16" cy="9.6" r="1.4" fill={edge} />
      </svg>
    </span>
  );
}

/** Ilustrasi tahu sederhana untuk dasar sidebar. */
export function TofuIllustration({ className = '' }) {
  return (
    <svg viewBox="0 0 220 120" className={className} fill="none" aria-hidden="true">
      <ellipse cx="110" cy="104" rx="92" ry="9" fill="#bbf7d0" fillOpacity=".7" />
      <path d="M40 62 78 44l38 18v32L78 112 40 94V62Z" fill="#fefce8" stroke="#a3a3a3" strokeOpacity=".35" />
      <path d="M40 62 78 80l38-18M78 80v32" stroke="#a3a3a3" strokeOpacity=".35" />
      <path d="M40 62 78 44l38 18-38 18-38-18Z" fill="#fff" />
      <path d="M118 52 150 37l32 15v27l-32 15-32-15V52Z" fill="#fefce8" stroke="#a3a3a3" strokeOpacity=".35" />
      <path d="M118 52 150 67l32-15M150 67v27" stroke="#a3a3a3" strokeOpacity=".35" />
      <path d="M118 52 150 37l32 15-32 15-32-15Z" fill="#fff" />
      <path d="M170 30c4-7 12-9 18-6-2 7-9 11-18 6Z" fill="#22c55e" />
      <path d="M170 30c6-1 11-1 18-6" stroke="#15803d" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
