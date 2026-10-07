import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { UIProvider, useUI } from './ui.tsx';
import { Icon, LumeMark, type IconName } from '../../lib/icons.tsx';
import { BrandLogo } from './BrandLogo.tsx';
import { Avatar, Button, Menu, Skeleton } from '../../components/ui.tsx';
import { Popover } from '../../components/extras.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { authClient } from '../../lib/auth.ts';
import { keys, useNotifications } from '../../lib/queries.ts';
import { useLiveUpdates, type LiveNotification } from '../../lib/live.ts';
import { relativeTime } from '../../lib/format.ts';
import { ROLE_LABEL } from '../../../shared/permissions.ts';
import type { Me } from '../../../shared/types.ts';
import { MeProvider, useMeData, can } from './me.tsx';
import { TaskPanel } from '../tasks/TaskPanel.tsx';
import { TaskCreateDialog } from '../tasks/TaskCreateDialog.tsx';
import { EventEditor } from '../calendar/EventEditor.tsx';
import { EventDetails } from '../calendar/EventDetails.tsx';
import { ProjectEditor } from '../projects/ProjectEditor.tsx';
import { ProfitEditor } from '../profit/ProfitEditor.tsx';
import { NoteEditor } from '../notes/NoteEditor.tsx';
import { LumePanel } from '../lume/LumePanel.tsx';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  active: IconName;
  end?: boolean;
  show?: (me: Me) => boolean;
}

const NAV: NavItem[] = [
  { to: '/app', label: 'Dashboard', icon: 'home', active: 'homeActive', end: true },
  { to: '/app/calendar', label: 'Calendar', icon: 'calendar', active: 'calendarActive' },
  { to: '/app/tasks', label: 'Tasks', icon: 'tasks', active: 'tasksActive' },
  { to: '/app/notes', label: 'Notes', icon: 'notes', active: 'notesActive' },
  { to: '/app/projects', label: 'Projects', icon: 'projects', active: 'projectsActive' },
  { to: '/app/clients', label: 'Clients', icon: 'clients', active: 'clientsActive' },
  { to: '/app/profit', label: 'Profit', icon: 'profit', active: 'profitActive', show: (me) => can(me, 'finance.viewSummary') },
];

export function AppShell({ me }: { me: Me }) {
  return (
    <MeProvider me={me}>
      <UIProvider>
        <Shell />
      </UIProvider>
    </MeProvider>
  );
}

function Shell() {
  const me = useMeData();
  const ui = useUI();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const onNotification = useCallback(
    (n: LiveNotification) => toast({ tone: 'info', message: n.title, action: n.link ? { label: 'Open', onClick: () => navigate(n.link!) } : undefined }),
    [toast, navigate],
  );
  const live = useLiveUpdates(true, onNotification);
  useIdleLock(me);

  // Move focus to the page on navigation so keyboard and screen-reader users start at the content.
  useEffect(() => {
    main.current?.focus({ preventScroll: true });
    setMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        if (ui.lume.open) ui.closeLume();
        else ui.openLume();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui]);

  const nav = NAV.filter((n) => !n.show || n.show(me));

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Primary">
        <div className="brand">
          <BrandLogo size={40} />
          <span className="brand-text">
            <span className="brand-name">{me.workspace!.name}</span>
            <span className="brand-sub">{me.workspace!.isDemo ? 'Demo workspace' : 'Workspace'}</span>
          </span>
        </div>
        <WorkspaceSwitcher />
        <nav className="nav">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              {({ isActive }) => (
                <>
                  <Icon name={isActive ? n.active : n.icon} size={19} />
                  {n.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button type="button" className="sidebar-lume" onClick={() => ui.openLume()}>
            <LumeMark size={18} />
            Ask Lume
            <kbd className="kbd">⌘J</kbd>
          </button>
          <UserChip />
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <div className="topbar-brand">
            <BrandLogo size={32} />
            <span className="topbar-name">{me.workspace!.name}</span>
          </div>
          <span className={`live-dot is-${live}`} title={live === 'live' ? 'Live updates on' : 'Reconnecting…'}>
            <span className="sr-only">{live === 'live' ? 'Live updates on' : 'Reconnecting to live updates'}</span>
          </span>
          <div className="topbar-actions">
            <QuickAdd />
            <Notifications />
            <Button variant="secondary" size="sm" className="topbar-lume" leading={<LumeMark size={16} />} onClick={() => ui.openLume()} aria-label="Ask Lume">
              <span className="hide-sm">Ask Lume</span>
            </Button>
          </div>
        </header>
        {me.workspace!.isDemo && (
          <div className="demo-banner" role="note">
            <Icon name="info" size={16} />
            <span>
              <strong>Demo workspace.</strong> Everything here is sample data for trying the product. It is separate from your company workspace.
            </span>
          </div>
        )}
        <div className="main-scroll" id="main-scroll">
          <main className="main" id="main" ref={main} tabIndex={-1}>
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>

      <nav className="tabbar" aria-label="Primary">
        {nav.slice(0, 4).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            {({ isActive }) => (
              <>
                <Icon name={isActive ? n.active : n.icon} size={21} />
                <span>{n.label}</span>
              </>
            )}
          </NavLink>
        ))}
        <button type="button" className={`tab ${moreOpen ? 'active' : ''}`} onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} data-popover-trigger>
          <Icon name="menu" size={21} />
          <span>More</span>
        </button>
        <Popover open={moreOpen} onClose={() => setMoreOpen(false)} className="more-sheet" label="More">
          {nav.slice(4).map((n) => (
            <NavLink key={n.to} to={n.to} className="more-link">
              <Icon name={n.icon} size={19} /> {n.label}
            </NavLink>
          ))}
          <NavLink to="/app/settings" className="more-link">
            <Icon name="settings" size={19} /> Settings
          </NavLink>
          <SignOutButton className="more-link" />
        </Popover>
      </nav>

      <TaskPanel />
      <TaskCreateDialog />
      <EventEditor />
      <EventDetails />
      <ProjectEditor />
      <ProfitEditor />
      <NoteEditor />
      <LumePanel />
    </div>
  );
}

function WorkspaceSwitcher() {
  const me = useMeData();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  if (me.workspaces.length < 2) return null;
  return (
    <label className="ws-switch">
      <span className="sr-only">Switch workspace</span>
      <select
        className="ws-select"
        value={me.workspace!.id}
        onChange={async (e) => {
          try {
            await api.post('/me/active-workspace', { orgId: e.target.value });
            qc.clear();
            navigate('/app');
          } catch (err) {
            toast({ tone: 'error', message: errorMessage(err) });
          }
        }}
      >
        {me.workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
            {w.isDemo ? ' (demo)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

function SignOutButton({ className }: { className: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await authClient.signOut();
        qc.clear();
        navigate('/signin');
      }}
    >
      <Icon name="signOut" size={19} /> Sign out
    </button>
  );
}

function UserChip() {
  const me = useMeData();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const items = [
    { label: 'Profile & settings', icon: 'settings' as const, onSelect: () => navigate('/app/settings') },
    ...(me.profile.hasPin
      ? [
          {
            label: 'Lock workspace',
            icon: 'lock' as const,
            onSelect: async () => {
              try {
                await api.post('/session/lock');
                await qc.invalidateQueries({ queryKey: keys.me });
              } catch (err) {
                toast({ tone: 'error', message: errorMessage(err) });
              }
            },
          },
        ]
      : []),
    {
      label: 'Sign out',
      icon: 'signOut' as const,
      onSelect: async () => {
        await authClient.signOut();
        qc.clear();
        navigate('/signin');
      },
    },
  ];
  return (
    <div className="user-chip">
      <NavLink to="/app/settings" className="user-chip-link">
        <Avatar member={{ id: me.user.id, name: me.user.name, avatarUrl: me.user.avatarUrl }} size={30} />
        <span className="user-chip-text">
          <span className="truncate">{me.user.name}</span>
          <span className="user-chip-role">{ROLE_LABEL[me.workspace!.role]}</span>
        </span>
      </NavLink>
      <div className="sidebar-menu">
        <Menu label="Account menu" items={items} align="start" />
      </div>
    </div>
  );
}

function QuickAdd() {
  const me = useMeData();
  const ui = useUI();
  const items = [
    { label: 'New task', icon: 'tasks' as const, onSelect: () => ui.openNewTask() },
    { label: 'New event', icon: 'calendarAdd' as const, onSelect: () => ui.openNewEvent() },
    { label: 'New note', icon: 'notes' as const, onSelect: () => ui.openNote() },
    { label: 'New project', icon: 'projects' as const, onSelect: () => ui.openProjectEditor() },
    ...(can(me, 'finance.record') ? [{ label: 'Add profit', icon: 'profit' as const, onSelect: () => ui.openProfitEditor() }] : []),
  ];
  return (
    <div className="quick-add">
      <Menu label="Create" items={items} icon="plus" />
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const q = useNotifications();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const unread = q.data?.unread ?? 0;
  const markAll = async () => {
    await api.post('/notifications/read', { ids: 'all' }).catch(() => {});
    void qc.invalidateQueries({ queryKey: keys.notifications });
  };
  return (
    <div className="notif">
      <button type="button" className="icon-btn icon-btn-md icon-btn-ghost notif-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen((v) => !v)} data-popover-trigger>
        <Icon name={unread ? 'bellActive' : 'bell'} size={19} />
        {unread > 0 && <span className="notif-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="notif-pop" label="Notifications">
        <div className="notif-head">
          <p className="notif-title">Notifications</p>
          {unread > 0 && (
            <button type="button" className="link-btn" onClick={markAll}>
              Mark all read
            </button>
          )}
        </div>
        {q.isPending && <p className="notif-empty">Loading…</p>}
        {q.data && q.data.items.length === 0 && <p className="notif-empty">You’re all caught up. Reminders and assignments will appear here.</p>}
        <ul className="notif-list">
          {q.data?.items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={`notif-item ${n.read ? '' : 'is-unread'}`}
                onClick={async () => {
                  setOpen(false);
                  if (!n.read) await api.post('/notifications/read', { ids: [n.id] }).catch(() => {});
                  void qc.invalidateQueries({ queryKey: keys.notifications });
                  if (n.link) navigate(n.link);
                }}
              >
                <Icon name={n.kind === 'event_reminder' ? 'clock' : n.kind === 'task_comment' ? 'chat' : n.kind === 'invite_accepted' || n.kind === 'admin_joined' ? 'userCheck' : 'tasks'} size={17} />
                <span className="notif-text">
                  <span>{n.title}</span>
                  {n.body && <span className="notif-body">{n.body}</span>}
                  <span className="notif-time">{relativeTime(n.createdAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  );
}

function PageLoading() {
  return (
    <div className="page" role="status" aria-label="Loading page">
      <Skeleton h={40} w="40%" />
      <Skeleton h={160} />
      <Skeleton h={120} />
    </div>
  );
}

/** Locks the session after the chosen idle time when a quick-unlock PIN is set. */
function useIdleLock(me: Me) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!me.profile.hasPin) return;
    let last = Date.now();
    const bump = () => (last = Date.now());
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const timer = window.setInterval(async () => {
      if (Date.now() - last > me.profile.autoLockMinutes * 60_000) {
        await api.post('/session/lock').catch(() => {});
        void qc.invalidateQueries({ queryKey: keys.me });
      }
    }, 20_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(timer);
    };
  }, [me.profile.hasPin, me.profile.autoLockMinutes, qc]);
}

