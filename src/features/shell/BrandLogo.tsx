// The Lumera Creative logo in the workspace header. It is a link to the
// dashboard home with restrained motion:
// - load: fades in with a small upward drift
// - hover (mouse or pen): grows slightly and tilts toward the pointer
// - click / tap / Enter: a short press-and-lift, then navigates home
// Reduced motion keeps the logo still and navigates normally.
import { useRef, type MouseEvent, type PointerEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { gsap, reducedMotion, skipMotion, useGSAP } from '../../lib/motion.ts';
import { LumeraLogo } from '../../components/LumeraLogo.tsx';

const HOME = '/app';
const MAX_TILT = 9; // degrees
const HOVER_SCALE = 1.07;
const NAVIGATE_AFTER_MS = 300;

export function BrandLogo({ size, className = '' }: { size: number; className?: string }) {
  const link = useRef<HTMLAnchorElement>(null);
  const art = useRef<HTMLSpanElement>(null);
  const tilt = useRef<HTMLSpanElement>(null);
  const hovering = useRef(false);
  const pressing = useRef(false);
  const setters = useRef<{ rx: gsap.QuickToFunc; ry: gsap.QuickToFunc } | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const { contextSafe } = useGSAP(
    () => {
      setters.current = {
        rx: gsap.quickTo(tilt.current, 'rotationX', { duration: 0.45, ease: 'power3.out' }),
        ry: gsap.quickTo(tilt.current, 'rotationY', { duration: 0.45, ease: 'power3.out' }),
      };
      if (skipMotion()) return;
      const intro = gsap.fromTo(art.current, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.9, delay: 0.08, ease: 'power3.out' });
      // Animation frames pause in background tabs: never leave the logo hidden.
      const settle = window.setTimeout(() => intro.progress() < 1 && intro.progress(1), 1300);
      return () => window.clearTimeout(settle);
    },
    { scope: link },
  );

  const canHover = (e: PointerEvent) => e.pointerType !== 'touch' && !reducedMotion();

  const onPointerEnter = contextSafe((e: PointerEvent) => {
    if (!canHover(e)) return;
    hovering.current = true;
    if (!pressing.current) gsap.to(tilt.current, { scale: HOVER_SCALE, duration: 0.45, ease: 'power3.out', overwrite: 'auto' });
  });

  const onPointerMove = contextSafe((e: PointerEvent<HTMLAnchorElement>) => {
    if (!canHover(e) || pressing.current) return;
    // Measured on the link, which never transforms, so the tilt can't feed back into itself.
    const r = e.currentTarget.getBoundingClientRect();
    const nx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
    const ny = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
    setters.current?.ry(nx * MAX_TILT);
    setters.current?.rx(-ny * MAX_TILT);
  });

  const onPointerLeave = contextSafe(() => {
    hovering.current = false;
    if (pressing.current) return;
    setters.current?.rx(0);
    setters.current?.ry(0);
    gsap.to(tilt.current, { scale: 1, duration: 0.6, ease: 'power3.out', overwrite: 'auto' });
  });

  const goHome = () => {
    if (location.pathname === HOME && !location.search) document.getElementById('main-scroll')?.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    else navigate(HOME);
  };

  const onClick = contextSafe((e: MouseEvent<HTMLAnchorElement>) => {
    // New tab / window: leave it to the browser.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (reducedMotion()) return goHome();
    if (pressing.current) return;
    pressing.current = true;
    gsap
      .timeline({ onComplete: () => void (pressing.current = false) })
      .to(tilt.current, { scale: 0.9, rotationX: 0, rotationY: 0, duration: 0.12, ease: 'power2.out', overwrite: 'auto' })
      .to(tilt.current, { scale: 1.05, rotation: -6, y: -2, duration: 0.22, ease: 'power3.out' })
      .to(tilt.current, { scale: () => (hovering.current ? HOVER_SCALE : 1), rotation: 0, y: 0, duration: 0.5, ease: 'power3.out' });
    // A timer rather than a tween callback, so navigation never waits on paused animation frames.
    window.setTimeout(goHome, NAVIGATE_AFTER_MS);
  });

  return (
    <Link
      ref={link}
      to={HOME}
      className={`brand-logo ${className}`}
      style={{ ['--logo-size' as string]: `${size}px` }}
      aria-label="Lumera Creative — dashboard home"
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      draggable={false}
    >
      <span className="brand-logo-art" ref={art}>
        <span className="brand-logo-tilt" ref={tilt}>
          <LumeraLogo size={size} />
        </span>
      </span>
    </Link>
  );
}
