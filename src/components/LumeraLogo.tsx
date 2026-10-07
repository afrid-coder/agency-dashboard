import logoUrl from '../assets/lumera-logo.png';

/**
 * The Lumera Creative logo: the black ring-and-bird artwork on a light disc,
 * so it stays legible on dark and light surfaces alike. Decorative: pair it
 * with the company name, or give the surrounding link an accessible name.
 */
export function LumeraLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`lumera-logo ${className}`} style={{ ['--logo-size' as string]: `${size}px` }} aria-hidden="true">
      <img src={logoUrl} alt="" width={size} height={size} draggable={false} decoding="async" />
    </span>
  );
}
