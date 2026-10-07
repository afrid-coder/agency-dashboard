import { useState } from 'react';
import { Icon } from '../../lib/icons.tsx';
import { Field, describedBy } from '../../components/ui.tsx';
import { passwordProblem } from '../../../shared/schemas.ts';

export function PasswordField({
  id,
  label = 'Password',
  value,
  onChange,
  error,
  autoComplete,
  showRules,
  email,
  autoFocus,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  autoComplete: 'current-password' | 'new-password';
  showRules?: boolean;
  email?: string;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const problem = showRules && value ? passwordProblem(value, { email }) : null;
  const hint = showRules ? (value ? (problem ?? 'Looks good.') : 'At least 10 characters. A few unrelated words work well.') : undefined;
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint}>
      <div className="password">
        <input
          id={id}
          className="input"
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy(id, error, hint)}
          autoFocus={autoFocus}
          maxLength={128}
          required
        />
        <button type="button" className="password-toggle" onClick={() => setVisible((v) => !v)} aria-pressed={visible} aria-label={visible ? 'Hide password' : 'Show password'}>
          <Icon name={visible ? 'eyeClosed' : 'eye'} size={17} />
          <span>{visible ? 'Hide' : 'Show'}</span>
        </button>
      </div>
      {showRules && value && <span className={`password-meter ${problem ? 'is-weak' : 'is-ok'}`} aria-hidden="true" />}
    </Field>
  );
}
