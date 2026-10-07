import { useState } from 'react';
import { Icon } from '../lib/icons.tsx';

/**
 * One real input (so password managers, paste and screen readers behave),
 * drawn as four slots. Digits only; show/hide toggles masking.
 */
export function PinInput({
  id,
  value,
  onChange,
  autoComplete = 'current-password',
  invalid,
  describedBy,
  autoFocus,
  label = 'PIN',
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: 'current-password' | 'new-password' | 'off';
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  label?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <div className={`pin ${invalid ? 'is-invalid' : ''} ${focused ? 'is-focused' : ''}`}>
      <div className="pin-slots" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => {
          const ch = value[i];
          const active = focused && (i === value.length || (i === 3 && value.length === 4));
          return (
            <span key={i} className={`pin-slot ${ch ? 'is-filled' : ''} ${active ? 'is-active' : ''}`}>
              {ch ? visible ? ch : <span className="pin-dot" /> : null}
            </span>
          );
        })}
      </div>
      <input
        id={id}
        className="pin-input"
        type={visible ? 'text' : 'password'}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-label={label}
        value={value}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
      />
      <button type="button" className="pin-toggle" onClick={() => setVisible((v) => !v)} aria-pressed={visible} aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}>
        <Icon name={visible ? 'eyeClosed' : 'eye'} size={18} />
        <span>{visible ? 'Hide' : 'Show'}</span>
      </button>
    </div>
  );
}
