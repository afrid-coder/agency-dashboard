import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { AuthLayout } from './AuthLayout.tsx';
import { Avatar, Button, Field, Notice } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { keys } from '../../lib/queries.ts';
import { detectTimeZone, timeZoneOptions } from '../../lib/format.ts';
import { resizeImage } from '../../lib/image.ts';
import { formatInstant } from '../../../shared/dates.ts';
import type { Me } from '../../../shared/types.ts';

/** Two short steps: who you are, then your time zone. */
export function OnboardingPage({ me }: { me: Me }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(me.user.name);
  const [jobTitle, setJobTitle] = useState(me.profile.jobTitle ?? '');
  const [timezone, setTimezone] = useState(me.profile.timezone !== 'UTC' ? me.profile.timezone : detectTimeZone());
  const [photo, setPhoto] = useState<string | null>(me.user.avatarUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  if (me.profile.onboarded) return <Navigate to={me.workspace ? '/app' : '/pending'} replace />;

  const pickPhoto = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      const dataUrl = await resizeImage(f, 320);
      await api.put('/me/avatar', { dataUrl });
      setPhoto(dataUrl);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Enter your name.');
    setError(null);
    setStep(2);
  };

  const finish = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/me/onboarding', { name: name.trim(), jobTitle: jobTitle.trim() || null, timezone });
      await qc.invalidateQueries({ queryKey: keys.me });
      navigate(me.workspace ? '/app' : '/pending', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout eyebrow={`Step ${step} of 2`} title={step === 1 ? 'Set up your profile' : 'Confirm your time zone'} subtitle={step === 1 ? 'This is how teammates will see you on tasks, events and comments.' : 'Dates, deadlines and reminders are shown in this time zone.'}>
      <div className="steps" aria-hidden="true">
        <span className={step >= 1 ? 'is-on' : ''} />
        <span className={step >= 2 ? 'is-on' : ''} />
      </div>
      {step === 1 ? (
        <form className="form-grid" onSubmit={next} noValidate>
          <div className="photo-row">
            <Avatar member={{ id: me.user.id, name: name || me.user.name, avatarUrl: photo }} size={56} />
            <div>
              <Button variant="secondary" size="sm" icon="camera" onClick={() => file.current?.click()}>
                {photo ? 'Change photo' : 'Add a photo'}
              </Button>
              <p className="field-hint">Optional. A clear photo helps teammates recognise you.</p>
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void pickPhoto(e.target.files?.[0])} />
            </div>
          </div>
          <Field label="Full name" htmlFor="name">
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" autoFocus />
          </Field>
          <Field label="Role or job title" htmlFor="job" optional>
            <input id="job" className="input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={80} placeholder="e.g. Designer, Developer, Account lead" />
          </Field>
          {error && <Notice tone="danger">{error}</Notice>}
          <Button type="submit" variant="primary" size="lg" iconRight="arrowRight">
            Continue
          </Button>
        </form>
      ) : (
        <form className="form-grid" onSubmit={finish}>
          <Field label="Time zone" htmlFor="tz" hint={`Local time there now: ${formatInstant(new Date(), timezone, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`}>
            <select id="tz" className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {timeZoneOptions(timezone).map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button type="submit" variant="primary" size="lg" loading={busy}>
              Finish
            </Button>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}
