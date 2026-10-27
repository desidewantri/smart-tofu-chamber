import { cn } from '@/lib/utils';

/** Logo TOSCHA: chamber tahu dengan sensor (file gambar di public/icons). */
export function LogoMark({ className = 'h-10 w-10', rounded = 'rounded-xl' }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/logo-256.png"
      alt="TOSCHA"
      width={256}
      height={256}
      className={cn('inline-block shrink-0 object-contain', rounded, className)}
    />
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
