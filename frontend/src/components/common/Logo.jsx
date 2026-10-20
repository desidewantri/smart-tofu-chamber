import { cn } from '@/lib/utils';

/** Logo: kubus tahu dengan gelombang sensor. Gambar asli buatan sendiri. */
export function LogoMark({ className = 'h-10 w-10', rounded = 'rounded-xl', variant = 'solid' }) {
  const light = variant === 'light';
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center shadow-sm',
        light ? 'bg-white' : 'bg-gradient-to-br from-brand-500 to-brand-700',
        rounded,
        className
      )}
    >
      <svg viewBox="0 0 48 48" className="h-4/5 w-4/5" fill="none" aria-hidden="true">
        {/* sinyal sensor */}
        <path d="M13 11a15 15 0 0 1 22 0" stroke={light ? '#0d9488' : '#99f6e4'} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M18 15.5a8.5 8.5 0 0 1 12 0" stroke={light ? '#0d9488' : '#ccfbf1'} strokeWidth="2.4" strokeLinecap="round" />
        {/* kubus tahu */}
        <path d="M24 20 10 27v10l14 7 14-7V27l-14-7Z" fill={light ? '#0d9488' : '#ffffff'} />
        <path d="M10 27l14 7 14-7M24 34v10" stroke={light ? '#ffffff' : '#0d9488'} strokeWidth="2" strokeLinejoin="round" />
        <circle cx="24" cy="26.6" r="1.8" fill={light ? '#ffffff' : '#0d9488'} />
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
