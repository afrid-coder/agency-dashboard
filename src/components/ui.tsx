import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type KeyboardEvent } from 'react';
import { Icon, type IconName } from '../lib/icons.tsx';
import { gsap, skipMotion } from '../lib/motion.ts';
import { initials, toneFor } from '../lib/format.ts';
import { apiAsset } from '../lib/api.ts';
import type { Member } from '../../shared/types.ts';

// ---------- Button ----------

type Variant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger' | 'quiet';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  kbd?: string;
  /** Custom leading graphic (e.g. the Lumera mark) when a Solar icon doesn't fit. */
  leading?: ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}

export function Button({ variant = 'secondary', size = 'md', icon, iconRight, loading, kbd, leading, children, className = '', disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size} ${loading ? 'is-loading' : ''} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : leading ?? null}
      {children !== undefined && <span className="btn-label">{children}</span>}
      {iconRight && !loading && <Icon name={iconRight} size={15} />}
      {kbd && <kbd className="kbd">{kbd}</kbd>}
    </button>
  );
}

export function IconButton({ icon, label, size = 'md', variant = 'ghost', className = '', ...rest }: Omit<ButtonProps, 'children' | 'icon'> & { icon: IconName; label: string }) {
  return (
    <button type="button" className={`icon-btn icon-btn-${size} icon-btn-${variant} ${className}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size === 'sm' ? 16 : 18} />
    </button>
  );
}

export const Spinner = ({ size = 16 }: { size?: number }) => <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;

// ---------- Form fields ----------

export function Field({
  label,
  hint,
  error,
  optional,
  children,
  htmlFor,
  className = '',
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: ReactNode;
  htmlFor: string;
  className?: string;
}) {
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {optional && <span className="field-optional">Optional</span>}
      </label>
      {children}
      {error ? (
        <p className="field-error" id={`${htmlFor}-error`} role="alert">
          <Icon name="warning" size={14} /> {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const describedBy = (id: string, error?: string, hint?: ReactNode) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);

// ---------- Segmented control (radio group) ----------

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'md',
  hideLabel = true,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: IconName; tone?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  hideLabel?: boolean;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className={`segmented segmented-${size}`} role="radiogroup" aria-labelledby={id}>
      <span id={id} className={hideLabel ? 'sr-only' : 'field-label'}>
        {label}
      </span>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          className={`segmented-item ${o.tone ? `tone-${o.tone}` : ''}`}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {o.icon && <Icon name={o.icon} size={15} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Task completion check (animated) ----------

export function TaskCheck({ checked, onToggle, label, disabled }: { checked: boolean; onToggle: () => void; label: string; disabled?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const prev = useRef(checked);
  useEffect(() => {
    if (checked && !prev.current && ref.current && !skipMotion()) {
      const path = ref.current.querySelector('path');
      gsap.fromTo(ref.current, { scale: 0.8 }, { scale: 1, duration: 0.45, ease: 'back.out(3)' });
      if (path) gsap.fromTo(path, { strokeDashoffset: 14 }, { strokeDashoffset: 0, duration: 0.3, ease: 'power2.out', delay: 0.05 });
    }
    prev.current = checked;
  }, [checked]);
  return (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={`task-check ${checked ? 'is-checked' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      disabled={disabled}
    >
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
        <circle cx="10" cy="10" r="8.25" />
        <path d="M6.2 10.3l2.5 2.5 5.1-5.3" strokeDasharray="14" strokeDashoffset={checked ? 0 : 14} />
      </svg>
    </button>
  );
}

export function Checkbox({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; id?: string }) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <label className="checkbox" htmlFor={cid}>
      <input id={cid} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="checkbox-box" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="12" height="12">
          <path d="M3.5 8.4l2.8 2.7 6.2-6.3" />
        </svg>
      </span>
      <span className="checkbox-label">{label}</span>
    </label>
  );
}

/** An on/off setting with a title and an optional line of explanation. */
export function Switch({ checked, onChange, label, description, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; id?: string }) {
  const auto = useId();
  const sid = id ?? auto;
  return (
    <div className={`switch-row ${checked ? 'is-on' : ''}`}>
      <span className="switch-text">
        <label className="switch-label" htmlFor={sid}>
          {label}
        </label>
        {description && (
          <span className="switch-desc" id={`${sid}-desc`}>
            {description}
          </span>
        )}
      </span>
      <button type="button" id={sid} role="switch" aria-checked={checked} aria-describedby={description ? `${sid}-desc` : undefined} className="switch" onClick={() => onChange(!checked)}>
        <span className="switch-thumb" aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------- Avatars ----------

export function Avatar({ member, size = 28, ring }: { member: Pick<Member, 'id' | 'name' | 'avatarUrl'> | null | undefined; size?: number; ring?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!member) return <span className="avatar avatar-empty" style={{ width: size, height: size }} aria-hidden="true" />;
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };
  return (
    <span className={`avatar tone-${toneFor(member.id)} ${ring ? 'avatar-ring' : ''}`} style={style} title={member.name}>
      {member.avatarUrl && !failed ? <img src={apiAsset(member.avatarUrl)!} alt="" onError={() => setFailed(true)} /> : <span aria-hidden="true">{initials(member.name)}</span>}
      <span className="sr-only">{member.name}</span>
    </span>
  );
}

export function AvatarStack({ members, size = 24, max = 3 }: { members: (Member | undefined)[]; size?: number; max?: number }) {
  const list = members.filter(Boolean) as Member[];
  if (list.length === 0) return <span className="avatar-stack-empty">Unassigned</span>;
  const shown = list.slice(0, max);
  const rest = list.length - shown.length;
  return (
    <span className="avatar-stack" aria-label={`Assigned to ${list.map((m) => m.name).join(', ')}`}>
      {shown.map((m) => (
        <Avatar key={m.id} member={m} size={size} ring />
      ))}
      {rest > 0 && (
        <span className="avatar avatar-more avatar-ring" style={{ width: size, height: size }}>
          +{rest}
        </span>
      )}
    </span>
  );
}

// ---------- Misc ----------

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={20} />
      </span>
      <p className="empty-title">{title}</p>
      {children && <p className="empty-body">{children}</p>}
      {action}
    </div>
  );
}

export const Skeleton = ({ w = '100%', h = 14, r = 6 }: { w?: number | string; h?: number; r?: number }) => (
  <span className="skeleton" style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />
);

export function Notice({ tone = 'info', icon, children, action }: { tone?: 'info' | 'warning' | 'danger' | 'success' | 'violet'; icon?: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon name={icon ?? (tone === 'danger' || tone === 'warning' ? 'warning' : tone === 'success' ? 'check' : 'info')} size={17} />
      <div className="notice-body">{children}</div>
      {action && <div className="notice-action">{action}</div>}
    </div>
  );
}

// ---------- Menu ----------

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function Menu({ label, items, icon = 'more', align = 'end' }: { label: string; items: MenuItem[]; icon?: IconName; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    requestAnimationFrame(() => itemRefs.current.find((b) => b && !b.disabled)?.focus());
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    const list = itemRefs.current.filter((b): b is HTMLButtonElement => Boolean(b && !b.disabled));
    const idx = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[(idx + 1) % list.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      list[(idx - 1 + list.length) % list.length]?.focus();
    } else if (e.key === 'Tab') close(false);
  };

  return (
    <div className="menu-wrap" ref={wrap} onClick={(e) => e.stopPropagation()}>
      <button
        ref={trigger}
        type="button"
        className="icon-btn icon-btn-sm icon-btn-ghost"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={icon} size={16} />
      </button>
      {open && (
        <div className={`menu menu-${align}`} role="menu" id={menuId} onKeyDown={onKey}>
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              className={`menu-item ${item.danger ? 'is-danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.icon && <Icon name={item.icon} size={16} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
