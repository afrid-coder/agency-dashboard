import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../lib/icons.tsx';
import { gsap, skipMotion } from '../lib/motion.ts';

type Tone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  message: string;
  tone: Tone;
  action?: { label: string; onClick: () => void };
  duration: number;
}

const Ctx = createContext<(t: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  // A modal <dialog> makes everything outside it inert, so toasts render
  // inside the top-most open modal (where Undo stays clickable), else in body.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const update = () => {
      const modals = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter((d) => d.matches(':modal'));
      setHost(modals[modals.length - 1] ?? document.body);
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    update();
    return () => observer.disconnect();
  }, []);
  const push = useCallback((t: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => {
    const id = next.current++;
    setToasts((list) => [...list.slice(-3), { ...t, id, duration: t.duration ?? (t.action ? 7000 : t.tone === 'error' ? 7000 : 4200) }]);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      {host &&
        createPortal(
          <div className="toast-region" role="region" aria-label="Notifications">
            <div aria-live="polite" aria-atomic="false" className="toast-stack">
              {toasts.map((t) => (
                <ToastItem key={t.id} toast={t} onDone={() => dismiss(t.id)} />
              ))}
            </div>
          </div>,
          host,
        )}
    </Ctx.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (ref.current && !skipMotion()) gsap.fromTo(ref.current, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.36 });
  }, []);
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(onDone, toast.duration);
    return () => window.clearTimeout(timer);
  }, [paused, toast.duration, onDone]);
  return (
    <div
      ref={ref}
      className={`toast toast-${toast.tone}`}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon name={toast.tone === 'success' ? 'checkFilled' : toast.tone === 'error' ? 'warning' : 'info'} size={18} className="toast-icon" />
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action!.onClick();
            onDone();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={onDone}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
