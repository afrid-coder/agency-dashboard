import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);
gsap.defaults({ ease: 'power3.out', duration: 0.5 });

export { gsap, useGSAP };

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Skip motion when the user asked for less of it, or when the page is in a
 * background tab (animation frames and timers are paused there, so an
 * entrance could otherwise leave content invisible until the tab is shown).
 */
export const skipMotion = () => reducedMotion() || (typeof document !== 'undefined' && document.hidden);

/** Staggered entrance for [data-reveal] children inside a scope. */
export function revealChildren(scope: Element | null, options: { y?: number; stagger?: number; delay?: number } = {}) {
  if (!scope) return;
  const targets = scope.querySelectorAll<HTMLElement>('[data-reveal]');
  if (targets.length === 0) return;
  if (skipMotion()) {
    gsap.set(targets, { opacity: 1, y: 0 });
    return;
  }
  gsap.fromTo(
    targets,
    { opacity: 0, y: options.y ?? 14 },
    { opacity: 1, y: 0, duration: 0.62, stagger: options.stagger ?? 0.06, delay: options.delay ?? 0, ease: 'power3.out', clearProps: 'transform' },
  );
  settleLater(targets, 0.62 + (options.delay ?? 0) + (options.stagger ?? 0.06) * targets.length);
}

/**
 * Animation frames pause in background tabs. Content must never stay hidden
 * behind a stalled entrance, so force the final state shortly after the
 * animation should have finished.
 */
function settleLater(targets: gsap.TweenTarget, seconds: number) {
  window.setTimeout(() => {
    gsap.killTweensOf(targets);
    gsap.set(targets, { opacity: 1, x: 0, y: 0, scale: 1, clearProps: 'transform' });
  }, seconds * 1000 + 250);
}

export function panelIn(el: HTMLElement | null, from: 'right' | 'bottom' | 'center') {
  if (!el) return;
  if (skipMotion()) {
    gsap.set(el, { opacity: 1, x: 0, y: 0, scale: 1 });
    return;
  }
  const start = from === 'right' ? { x: 36 } : from === 'bottom' ? { y: 64 } : { y: 12, scale: 0.985 };
  gsap.fromTo(el, { opacity: 0, ...start }, { opacity: 1, x: 0, y: 0, scale: 1, duration: from === 'center' ? 0.32 : 0.42, ease: 'power3.out' });
  settleLater(el, 0.42);
}

export function panelOut(el: HTMLElement | null, to: 'right' | 'bottom' | 'center'): Promise<void> {
  if (!el || skipMotion()) return Promise.resolve();
  const end = to === 'right' ? { x: 28 } : to === 'bottom' ? { y: 48 } : { y: 8, scale: 0.985 };
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    gsap.to(el, { opacity: 0, ...end, duration: 0.2, ease: 'power2.in', onComplete: finish });
    // Animation frames pause in background tabs; never let a close hang on them.
    window.setTimeout(finish, 320);
  });
}
