import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Dialog } from './Dialog.tsx';
import { Avatar, Button, Spinner } from './ui.tsx';
import { Icon } from '../lib/icons.tsx';
import type { Member } from '../../shared/types.ts';

// ---------- Member picker (multi-select) ----------

export function MemberPicker({
  id,
  members,
  value,
  onChange,
  placeholder = 'Unassigned',
  label,
}: {
  id: string;
  members: Member[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const selected = members.filter((m) => value.includes(m.id));
  const toggle = (mid: string) => onChange(value.includes(mid) ? value.filter((v) => v !== mid) : [...value, mid]);
  return (
    <div className="picker" ref={wrap} onKeyDown={(e) => e.key === 'Escape' && open && (e.stopPropagation(), setOpen(false))}>
      <button id={id} type="button" className="input picker-trigger" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((v) => !v)}>
        {selected.length === 0 ? (
          <span className="picker-placeholder">{placeholder}</span>
        ) : (
          <span className="picker-values">
            {selected.slice(0, 3).map((m) => (
              <span key={m.id} className="picker-chip">
                <Avatar member={m} size={18} />
                {m.name.split(' ')[0]}
              </span>
            ))}
            {selected.length > 3 && <span className="picker-more">+{selected.length - 3}</span>}
          </span>
        )}
        <Icon name="down" size={15} />
      </button>
      {open && (
        <div className="picker-pop" role="listbox" id={listId} aria-multiselectable="true" aria-label={label}>
          {members.map((m) => {
            const on = value.includes(m.id);
            return (
              <button key={m.id} type="button" role="option" aria-selected={on} className={`picker-option ${on ? 'is-on' : ''}`} onClick={() => toggle(m.id)}>
                <Avatar member={m} size={24} />
                <span className="picker-option-text">
                  <span>{m.name}</span>
                  <span className="picker-option-sub">{m.jobTitle ?? m.role}</span>
                </span>
                {on && <Icon name="checkFilled" size={17} className="picker-check" />}
              </button>
            );
          })}
          {members.length === 0 && <p className="picker-empty">No members yet.</p>}
        </div>
      )}
    </div>
  );
}

// ---------- Confirm dialog ----------

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = 'danger',
  onConfirm,
  onClose,
  busy,
  extra,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  extra?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {extra}
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm-body">{children}</div>
    </Dialog>
  );
}

// ---------- Save state ----------

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function SaveState({ status, onRetry }: { status: SaveStatus; onRetry?: () => void }) {
  if (status === 'idle') return <span className="save-state" aria-live="polite" />;
  return (
    <span className={`save-state is-${status}`} aria-live="polite">
      {status === 'saving' && (
        <>
          <Spinner size={12} /> Saving…
        </>
      )}
      {status === 'saved' && (
        <>
          <Icon name="check" size={14} /> Saved
        </>
      )}
      {status === 'error' && (
        <>
          <Icon name="warning" size={14} /> Not saved
          {onRetry && (
            <button type="button" className="link-btn" onClick={onRetry}>
              Retry
            </button>
          )}
        </>
      )}
    </span>
  );
}

// ---------- Popover ----------

export function Popover({ open, onClose, children, className = '', label }: { open: boolean; onClose: () => void; children: ReactNode; className?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest('[data-popover-trigger]')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className={`popover ${className}`} role="dialog" aria-label={label}>
      {children}
    </div>
  );
}

export function Tag({ tone, children }: { tone?: 'high' | 'medium' | 'low' | 'success' | 'danger' | 'violet'; children: ReactNode }) {
  return <span className={`tag ${tone ? `tag-${tone}` : ''}`}>{children}</span>;
}
