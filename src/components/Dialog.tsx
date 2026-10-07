import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { panelIn, panelOut } from '../lib/motion.ts';
import { IconButton } from './ui.tsx';

type Variant = 'modal' | 'panel';

const isNarrow = () => window.matchMedia('(max-width: 767px)').matches;

/**
 * Accessible dialog on the native <dialog> element: focus is trapped and
 * restored by the browser, Escape closes, the page behind is inert.
 * 'panel' renders as a right-hand side panel on desktop and a bottom sheet
 * on small screens.
 */
export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  eyebrow,
  children,
  footer,
  variant = 'modal',
  size = 'md',
  headerAside,
  initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  headerAside?: ReactNode;
  initialFocus?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const closing = useRef(false);
  const titleId = useId();

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  const direction = () => (variant === 'panel' ? (isNarrow() ? 'bottom' : 'right') : isNarrow() ? 'bottom' : 'center');

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg || !mounted) return;
    if (open && !dlg.open) {
      dlg.showModal();
      panelIn(surface.current, direction());
      // showModal() picks the first focusable element; prefer an explicit target.
      window.setTimeout(() => dlg.querySelector<HTMLElement>(initialFocus ?? '[data-autofocus]')?.focus(), 0);
    } else if (!open && dlg.open && !closing.current) {
      closing.current = true;
      void panelOut(surface.current, direction()).then(() => {
        dlg.close();
        closing.current = false;
        setMounted(false);
      });
    }
  }, [open, mounted]);

  if (!mounted) return null;

  return (
    <dialog
      ref={ref}
      className={`dialog dialog-${variant} dialog-${size}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby={titleId}
    >
      <div className="dialog-surface" ref={surface}>
        {variant === 'panel' && <span className="sheet-handle" aria-hidden="true" />}
        <header className="dialog-header">
          <div className="dialog-heading">
            {eyebrow && <p className="mono-label">{eyebrow}</p>}
            <h2 id={titleId} className="dialog-title">
              {title}
            </h2>
            {subtitle && <p className="dialog-subtitle">{subtitle}</p>}
          </div>
          <div className="dialog-header-aside">
            {headerAside}
            <IconButton icon="x" label="Close" onClick={onClose} />
          </div>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-footer">{footer}</footer>}
      </div>
    </dialog>
  );
}
