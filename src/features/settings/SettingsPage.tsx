import { useEffect, useRef, useState, type FormEvent } from 'react';
import { NavLink, Navigate, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar, Button, Checkbox, EmptyState, Field, Notice, Segmented, Skeleton } from '../../components/ui.tsx';
import { ConfirmDialog } from '../../components/extras.tsx';
import { PinInput } from '../../components/PinInput.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Icon, type IconName } from '../../lib/icons.tsx';
import { api, ApiRequestError, errorMessage } from '../../lib/api.ts';
import { authClient, authError } from '../../lib/auth.ts';
import { keys, useInvitations, useMembers } from '../../lib/queries.ts';
import { applyTheme, readTheme, type ThemePref } from '../../lib/theme.ts';
import { relativeTime, timeZoneOptions } from '../../lib/format.ts';
import { resizeImage } from '../../lib/image.ts';
import { can, useMeData } from '../shell/me.tsx';
import { PasswordField } from '../auth/PasswordField.tsx';
import { REMINDERS } from '../calendar/calUtils.ts';
import { ROLE_LABEL, ROLE_SUMMARY, type Role } from '../../../shared/permissions.ts';
import { formatInstant } from '../../../shared/dates.ts';
import { formatCents } from '../../../shared/money.ts';
import { passwordProblem } from '../../../shared/schemas.ts';
import type { Me, NotificationPreferences } from '../../../shared/types.ts';

type Tab = 'profile' | 'security' | 'notifications' | 'appearance' | 'lume' | 'workspace' | 'members';

const TABS: { id: Tab; label: string; icon: IconName; show?: (me: Me) => boolean }[] = [
  { id: 'profile', label: 'Profile', icon: 'user' },
  { id: 'security', label: 'Security', icon: 'shield' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'lume', label: 'Lume & data', icon: 'database' },
  { id: 'workspace', label: 'Workspace', icon: 'settings', show: (me) => can(me, 'workspace.manage') },
  { id: 'members', label: 'Members', icon: 'people' },
];

export function SettingsPage() {
  const me = useMeData();
  const { tab = 'profile' } = useParams();
  const tabs = TABS.filter((t) => !t.show || t.show(me));
  useEffect(() => {
    document.title = 'Settings · Lumera Creative';
  }, []);
  if (!tabs.some((t) => t.id === tab)) return <Navigate to="/app/settings" replace />;
  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-text">
          <p className="mono-label">Account & workspace</p>
          <h1 className="page-title">Settings</h1>
        </div>
      </header>
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {tabs.map((t) => (
            <NavLink key={t.id} to={t.id === 'profile' ? '/app/settings' : `/app/settings/${t.id}`} end className={({ isActive }) => `settings-link ${isActive ? 'active' : ''}`}>
              <Icon name={t.icon} size={17} /> {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="settings-body">
          {tab === 'profile' && <ProfileSettings />}
          {tab === 'security' && <SecuritySettings />}
          {tab === 'notifications' && <NotificationSettings />}
          {tab === 'appearance' && <AppearanceSettings />}
          {tab === 'lume' && <LumeSettings />}
          {tab === 'workspace' && <WorkspaceSettings />}
          {tab === 'members' && <MemberSettings />}
        </div>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="card settings-section">
      <div className="card-body">
        <h2 className="settings-title">{title}</h2>
        {description && <p className="settings-desc">{description}</p>}
        {children}
      </div>
    </section>
  );
}

// ─── Profile ─────────────────────────────────────────────────────────────

function ProfileSettings() {
  const me = useMeData();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(me.user.name);
  const [jobTitle, setJobTitle] = useState(me.profile.jobTitle ?? '');
  const [timezone, setTimezone] = useState(me.profile.timezone);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast({ tone: 'error', message: 'Enter your name.' });
    setBusy(true);
    try {
      await api.patch('/me/profile', { name: name.trim(), jobTitle: jobTitle.trim() || null, timezone });
      await qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.members });
      toast({ tone: 'success', message: 'Profile saved' });
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  const photo = async (f?: File) => {
    if (!f) return;
    try {
      await api.put('/me/avatar', { dataUrl: await resizeImage(f, 320) });
      await qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.members });
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) });
    }
  };
  return (
    <Section title="Profile" description="How you appear to teammates on tasks, events and comments.">
      <div className="photo-row">
        <Avatar member={{ id: me.user.id, name: me.user.name, avatarUrl: me.user.avatarUrl }} size={64} />
        <div className="row-gap">
          <Button size="sm" variant="secondary" icon="camera" onClick={() => file.current?.click()}>
            {me.user.avatarUrl ? 'Change photo' : 'Upload photo'}
          </Button>
          {me.user.avatarUrl && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await api.del('/me/avatar').catch(() => {});
                await qc.invalidateQueries({ queryKey: keys.me });
                void qc.invalidateQueries({ queryKey: keys.members });
              }}
            >
              Remove
            </Button>
          )}
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void photo(e.target.files?.[0])} />
        </div>
      </div>
      <form className="form-grid narrow" onSubmit={save}>
        <Field label="Full name" htmlFor="pr-name">
          <input id="pr-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
        </Field>
        <Field label="Email" htmlFor="pr-email" hint="Your sign-in address. Contact an owner if it needs to change.">
          <input id="pr-email" className="input" value={me.user.email} readOnly />
        </Field>
        <Field label="Role or job title" htmlFor="pr-job" optional>
          <input id="pr-job" className="input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Time zone" htmlFor="pr-tz" hint={`Your local time: ${formatInstant(new Date(), timezone, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`}>
          <select id="pr-tz" className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {timeZoneOptions(timezone).map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <Button type="submit" variant="primary" loading={busy}>
            Save profile
          </Button>
        </div>
      </form>
    </Section>
  );
}

// ─── Security ────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

const deviceLabel = (ua?: string | null) => {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` on ${os}` : ''}`;
};

function SecuritySettings() {
  const me = useMeData();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const [list, cur] = await Promise.all([authClient.listSessions(), authClient.getSession()]);
      if (list.error) throw new Error(authError(list.error));
      return { list: (list.data ?? []) as unknown as SessionRow[], currentToken: cur.data?.session.token };
    },
  });

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(next, { email: me.user.email });
    if (problem) return setPwError(problem);
    setPwBusy(true);
    setPwError(null);
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: revokeOthers });
    setPwBusy(false);
    if (error) return setPwError(authError(error));
    setCurrent('');
    setNext('');
    void sessions.refetch();
    toast({ tone: 'success', message: revokeOthers ? 'Password changed. Other sessions were signed out.' : 'Password changed.' });
  };

  return (
    <>
      <Section title="Password" description="Use at least 10 characters. Changing it can sign you out everywhere else.">
        <form className="form-grid narrow" onSubmit={changePassword}>
          <PasswordField id="pw-current" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
          <PasswordField id="pw-new" label="New password" value={next} onChange={setNext} autoComplete="new-password" showRules email={me.user.email} />
          <Checkbox checked={revokeOthers} onChange={setRevokeOthers} label="Sign out of other devices" />
          {pwError && <Notice tone="danger">{pwError}</Notice>}
          <div>
            <Button type="submit" variant="primary" loading={pwBusy} disabled={!current || !next}>
              Change password
            </Button>
          </div>
        </form>
      </Section>

      <Section title="Where you’re signed in" description="Sessions last 14 days and renew while you use the app.">
        {sessions.isPending && <Skeleton h={60} />}
        {sessions.isError && <Notice tone="danger">{errorMessage(sessions.error)}</Notice>}
        <ul className="sessions">
          {sessions.data?.list.map((s) => {
            const isCurrent = s.token === sessions.data.currentToken;
            return (
              <li key={s.id}>
                <Icon name={/Mobile|iPhone|Android/.test(s.userAgent ?? '') ? 'phone' : 'monitor'} size={20} />
                <div className="session-text">
                  <p>
                    {deviceLabel(s.userAgent)} {isCurrent && <span className="tag tag-success tag-xs">This device</span>}
                  </p>
                  <p className="muted-sm">
                    Signed in {relativeTime(new Date(s.createdAt).toISOString())}
                    {s.ipAddress ? ` · ${s.ipAddress}` : ''}
                  </p>
                </div>
                {!isCurrent && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await authClient.revokeSession({ token: s.token });
                      void sessions.refetch();
                    }}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {(sessions.data?.list.length ?? 0) > 1 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await authClient.revokeOtherSessions();
              void sessions.refetch();
              toast({ tone: 'success', message: 'Signed out of all other devices' });
            }}
          >
            Sign out of all other devices
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon="signOut"
          onClick={async () => {
            await authClient.signOut();
            qc.clear();
            navigate('/signin');
          }}
        >
          Sign out here
        </Button>
      </Section>

      <PinSettings />
    </>
  );
}

function PinSettings() {
  const me = useMeData();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState(me.profile.autoLockMinutes);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put('/me/pin', { pin, password });
      await qc.invalidateQueries({ queryKey: keys.me });
      setEditing(false);
      setPin('');
      setPassword('');
      toast({ tone: 'success', message: 'Quick-unlock PIN saved' });
    } catch (err) {
      setError(err instanceof ApiRequestError ? (err.fields.pin ?? err.fields.password ?? err.message) : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Quick-unlock PIN"
      description="Optional. A four-digit PIN unlocks the app after it locks from inactivity on a device where you’re already signed in with your password. It can never be used to sign in."
    >
      {me.profile.hasPin && !editing ? (
        <div className="form-grid narrow">
          <p className="row-gap">
            <Icon name="lock" size={17} /> PIN is set. The app locks after
            <select
              aria-label="Lock after"
              className="select select-sm inline-select"
              value={minutes}
              onChange={async (e) => {
                const v = Number(e.target.value);
                setMinutes(v);
                await api.patch('/me/security', { autoLockMinutes: v }).catch((err) => toast({ tone: 'error', message: errorMessage(err) }));
                void qc.invalidateQueries({ queryKey: keys.me });
              }}
            >
              {[5, 15, 30, 60, 120, 240].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}
                </option>
              ))}
            </select>
            of inactivity.
          </p>
          <div className="row-gap">
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Change PIN
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                await api.del('/me/pin').catch((err) => toast({ tone: 'error', message: errorMessage(err) }));
                await qc.invalidateQueries({ queryKey: keys.me });
              }}
            >
              Remove PIN
            </Button>
          </div>
        </div>
      ) : editing || !me.profile.hasPin ? (
        editing ? (
          <form className="form-grid narrow" onSubmit={save}>
            <Field label="New PIN" htmlFor="pin-new">
              <PinInput id="pin-new" value={pin} onChange={setPin} autoComplete="new-password" />
            </Field>
            <PasswordField id="pin-password" label="Confirm with your password" value={password} onChange={setPassword} autoComplete="current-password" />
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="row-gap">
              <Button type="submit" variant="primary" loading={busy} disabled={pin.length !== 4 || !password}>
                Save PIN
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" icon="key" onClick={() => setEditing(true)}>
            Set up a PIN
          </Button>
        )
      ) : null}
    </Section>
  );
}

// ─── Notifications ───────────────────────────────────────────────────────

function NotificationSettings() {
  const me = useMeData();
  const qc = useQueryClient();
  const toast = useToast();
  const [prefs, setPrefs] = useState<NotificationPreferences>(me.preferences);
  const save = async (next: NotificationPreferences) => {
    setPrefs(next);
    try {
      await api.put('/me/preferences', next);
      void qc.invalidateQueries({ queryKey: keys.me });
    } catch (err) {
      setPrefs(me.preferences);
      toast({ tone: 'error', message: `Not saved: ${errorMessage(err)}` });
    }
  };
  const toggle = (k: keyof NotificationPreferences) => (v: boolean) => void save({ ...prefs, [k]: v });
  return (
    <Section title="Notifications" description="In-app notifications appear in the bell menu and as a brief message while you’re using the app. Changes save immediately.">
      <div className="form-grid narrow">
        <Checkbox checked={prefs.eventReminders} onChange={toggle('eventReminders')} label="Reminders before events I organise or attend" />
        <Field label="Default reminder for new events" htmlFor="np-rem">
          <select id="np-rem" className="select" value={prefs.defaultReminderMinutes} onChange={(e) => void save({ ...prefs, defaultReminderMinutes: Number(e.target.value) })}>
            {REMINDERS.filter((r) => r.value !== null && r.value <= 1440).map((r) => (
              <option key={r.label} value={r.value!}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Checkbox checked={prefs.taskAssigned} onChange={toggle('taskAssigned')} label="When someone assigns me a task" />
        <Checkbox checked={prefs.taskDue} onChange={toggle('taskDue')} label="On the morning a task of mine is due" />
        <Checkbox checked={prefs.taskComments} onChange={toggle('taskComments')} label="Comments on tasks I created or am assigned to" />
        <Checkbox checked={prefs.emailAssignments} onChange={toggle('emailAssignments')} label="Also email me when I’m assigned a task" />
      </div>
    </Section>
  );
}

// ─── Appearance ──────────────────────────────────────────────────────────

function AppearanceSettings() {
  const [theme, setTheme] = useState<ThemePref>(readTheme());
  return (
    <Section title="Appearance" description="Saved on this device.">
      <Segmented<ThemePref>
        label="Theme"
        hideLabel={false}
        value={theme}
        onChange={(v) => {
          setTheme(v);
          applyTheme(v);
        }}
        options={[
          { value: 'system', label: 'Match system', icon: 'monitor' },
          { value: 'light', label: 'Light', icon: 'sun' },
          { value: 'dark', label: 'Dark', icon: 'moon' },
        ]}
      />
      <p className="muted-sm">Motion follows your system’s “reduce motion” setting.</p>
    </Section>
  );
}

// ─── Lume & data ─────────────────────────────────────────────────────────

function LumeSettings() {
  const me = useMeData();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const status = useQuery({ queryKey: keys.lumeStatus, queryFn: () => api.get<{ mode: string; model: string | null; usage: { requests: number; limit: number } }>('/lume/status') });
  return (
    <>
      <Section title="Lume" description="Lumera Creative’s AI assistant. Powered by Anthropic’s Claude models.">
        <ul className="about-list">
          <li>
            <Icon name="info" size={16} />
            {me.lume.mode === 'live' ? `Connected${me.lume.model ? ` · ${me.lume.model}` : ''}.` : me.lume.mode === 'demo' ? 'Development demo mode — answers are scripted from your records and labelled as demo responses.' : 'Not connected. An owner needs to set ANTHROPIC_API_KEY on the server.'}
          </li>
          <li>
            <Icon name="database" size={16} /> When you ask Lume something, the workspace records relevant to your request are sent to Anthropic to generate the answer. Lume only reads what your role allows.
          </li>
          <li>
            <Icon name="shield" size={16} /> Lume never changes records without your confirmation.
          </li>
          {status.data && (
            <li>
              <Icon name="chart" size={16} /> Today you’ve used {status.data.usage.requests} of {status.data.usage.limit} requests.
            </li>
          )}
        </ul>
        <Button variant="danger" icon="trash" onClick={() => setConfirm(true)}>
          Delete my Lume conversations
        </Button>
      </Section>
      {can(me, 'data.export') && <ExportSection />}
      <ConfirmDialog
        open={confirm}
        title="Delete all your Lume conversations?"
        confirmLabel="Delete all"
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          try {
            await api.del('/lume/conversations');
            void qc.invalidateQueries({ queryKey: ['lume'] });
            void qc.invalidateQueries({ queryKey: keys.briefing });
            toast({ tone: 'success', message: 'Your Lume conversations were deleted' });
          } catch (err) {
            toast({ tone: 'error', message: errorMessage(err) });
          }
          setConfirm(false);
        }}
      >
        This permanently removes your conversations and saved briefings in this workspace. Tasks and events you confirmed stay in place.
      </ConfirmDialog>
    </>
  );
}

function ExportSection() {
  return (
    <Section title="Export" description="Download the workspace’s core business records. Exports are logged in the activity history.">
      <div className="row-gap wrap">
        <a className="btn btn-secondary btn-md" href="/api/export/workspace.json" download>
          <Icon name="download" size={17} /> <span className="btn-label">Everything (JSON)</span>
        </a>
        <a className="btn btn-secondary btn-md" href="/api/export/tasks.csv" download>
          <Icon name="download" size={17} /> <span className="btn-label">Tasks (CSV)</span>
        </a>
        <a className="btn btn-secondary btn-md" href="/api/export/profit.csv" download>
          <Icon name="download" size={17} /> <span className="btn-label">Profit (CSV)</span>
        </a>
      </div>
    </Section>
  );
}

// ─── Workspace ───────────────────────────────────────────────────────────

function WorkspaceSettings() {
  const me = useMeData();
  const ws = me.workspace!;
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(ws.name);
  const [timezone, setTimezone] = useState(ws.timezone);
  const [weekStartsOn, setWeekStartsOn] = useState<0 | 1>(ws.weekStartsOn);
  const [membersSeeProfit, setMembersSeeProfit] = useState(ws.membersSeeProfit);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/workspace', { name: name.trim(), timezone, weekStartsOn, membersSeeProfit });
      await qc.invalidateQueries({ queryKey: keys.me });
      toast({ tone: 'success', message: 'Workspace settings saved' });
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Section title="Workspace" description="Shared settings for everyone in this workspace.">
        <form className="form-grid narrow" onSubmit={save}>
          <Field label="Workspace name" htmlFor="ws-name">
            <input id="ws-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Workspace time zone" htmlFor="ws-tz" hint="Used for reminders and background jobs. Each person sees dates in their own time zone.">
            <select id="ws-tz" className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {timeZoneOptions(timezone).map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Weeks start on" htmlFor="ws-week">
            <select id="ws-week" className="select" value={weekStartsOn} onChange={(e) => setWeekStartsOn(Number(e.target.value) as 0 | 1)}>
              <option value={1}>Monday</option>
              <option value={0}>Sunday</option>
            </select>
          </Field>
          <Checkbox checked={membersSeeProfit} onChange={setMembersSeeProfit} label="Members can see monthly goal progress (totals only, never individual entries)" />
          <p className="muted-sm">
            Default monthly target: {formatCents(ws.defaultTargetCents)}. Change the target for a month from the Profit page.
          </p>
          <div>
            <Button type="submit" variant="primary" loading={busy}>
              Save workspace
            </Button>
          </div>
        </form>
      </Section>
      <ExportSection />
      <Section title="Backups" description="Backups are handled by your PostgreSQL provider — see the README for setup and recovery steps. Use the exports above for a portable copy of your records.">
        <p className="muted-sm">
          <Icon name="info" size={13} /> Keep at least daily automated backups with point-in-time recovery enabled in production.
        </p>
      </Section>
    </>
  );
}

// ─── Members ─────────────────────────────────────────────────────────────

function MemberSettings() {
  const me = useMeData();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const members = useMembers();
  const canManage = can(me, 'members.manage');
  const invitations = useInvitations(can(me, 'members.invite'));
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.members });
    void qc.invalidateQueries({ queryKey: keys.invitations });
  };

  const sendInvite = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setInviteError(null);
    try {
      await api.post('/invitations', { email, role });
      toast({ tone: 'success', message: `Invitation sent to ${email}` });
      setEmail('');
      refresh();
    } catch (err) {
      setInviteError(err instanceof ApiRequestError ? (err.fields.email ?? err.message) : errorMessage(err));
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (userId: string, next: Role) => {
    try {
      await api.patch(`/members/${userId}`, { role: next });
      refresh();
      void qc.invalidateQueries({ queryKey: keys.me });
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) });
    }
  };

  const remove = async () => {
    if (!removing) return;
    const self = removing.id === me.user.id;
    try {
      await api.del(`/members/${removing.id}`);
      setRemoving(null);
      if (self) {
        qc.clear();
        navigate('/pending');
      } else refresh();
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) });
      setRemoving(null);
    }
  };

  return (
    <>
      {can(me, 'members.invite') && (
        <Section title="Invite people" description="Invitations are tied to an email address and expire after 7 days. The person creates an account (or signs in) with that email to join.">
          <form className="invite-form" onSubmit={sendInvite} noValidate>
            <Field label="Email" htmlFor="inv-email" error={inviteError ?? undefined}>
              <input id="inv-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
            </Field>
            <Field label="Role" htmlFor="inv-role">
              <select id="inv-role" className="select" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <Button type="submit" variant="primary" icon="invite" loading={busy} disabled={!email.trim()}>
              Send invite
            </Button>
          </form>
          <p className="muted-sm">
            <strong>Member</strong>: {ROLE_SUMMARY.member} <strong>Admin</strong>: {ROLE_SUMMARY.admin}
          </p>
          {invitations.data && invitations.data.length > 0 && (
            <ul className="invites">
              {invitations.data.map((i) => (
                <li key={i.id}>
                  <Icon name="mail" size={18} />
                  <div className="session-text">
                    <p>
                      {i.email} <span className="tag tag-xs">{ROLE_LABEL[i.role]}</span>
                    </p>
                    <p className="muted-sm">{i.expired ? 'Expired' : `Expires ${relativeTime(i.expiresAt).replace(' ago', '')}`} · invited by {i.invitedBy ?? 'an admin'}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await api.post(`/invitations/${i.id}/resend`);
                        toast({ tone: 'success', message: `New invitation sent to ${i.email}` });
                        refresh();
                      } catch (err) {
                        toast({ tone: 'error', message: errorMessage(err) });
                      }
                    }}
                  >
                    Resend
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await api.del(`/invitations/${i.id}`).catch((err) => toast({ tone: 'error', message: errorMessage(err) }));
                      refresh();
                    }}
                  >
                    Cancel
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
      <Section title="Members" description={canManage ? 'Change roles or remove people. A workspace always keeps at least one owner.' : 'People in this workspace.'}>
        {members.isPending && <Skeleton h={80} />}
        {members.data?.length === 0 && <EmptyState icon="people" title="No members" />}
        <ul className="members">
          {members.data?.map((m) => {
            const self = m.id === me.user.id;
            const canEdit = canManage && !self && (m.role !== 'owner' || me.workspace!.role === 'owner');
            return (
              <li key={m.id}>
                <Avatar member={m} size={36} />
                <div className="session-text">
                  <p>
                    {m.name} {self && <span className="muted-sm">(you)</span>}
                  </p>
                  <p className="muted-sm">
                    {m.email}
                    {m.jobTitle ? ` · ${m.jobTitle}` : ''}
                  </p>
                </div>
                {canEdit ? (
                  <select className="select select-sm" aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => void changeRole(m.id, e.target.value as Role)}>
                    {(me.workspace!.role === 'owner' ? (['owner', 'admin', 'member'] as Role[]) : (['admin', 'member'] as Role[])).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="tag">{ROLE_LABEL[m.role]}</span>
                )}
                {(canEdit || self) && (
                  <Button size="sm" variant="ghost" onClick={() => setRemoving({ id: m.id, name: m.name })}>
                    {self ? 'Leave' : 'Remove'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
      <ConfirmDialog open={removing !== null} title={removing?.id === me.user.id ? 'Leave this workspace?' : `Remove ${removing?.name}?`} confirmLabel={removing?.id === me.user.id ? 'Leave workspace' : 'Remove'} onClose={() => setRemoving(null)} onConfirm={() => void remove()}>
        {removing?.id === me.user.id
          ? 'You’ll lose access to this workspace’s data until someone invites you again.'
          : 'They lose access immediately. Their open tasks become unassigned; everything they created stays in the workspace.'}
      </ConfirmDialog>
    </>
  );
}
