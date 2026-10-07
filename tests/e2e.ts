// End-to-end journey against a real server and a throwaway database.
//
//   npm run test:e2e
//
// Starts its own API on a spare port with an empty embedded PostgreSQL in a
// temporary folder (your data is never touched), seeds a separate demo
// workspace to prove cross-workspace isolation, then walks the full journey:
// instant sign-up, the admin code, the business partner joining the same
// workspace, invitation, projects/tasks/events, both owners seeing each
// other's work (labelled with who added it) and shared notes, live updates,
// profit, Lume (demo mode) with a confirmed action, persistence, permissions,
// password reset, time zones and recurrence.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8800 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const ADMIN_CODE = '2580';
const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'lumera-e2e-'));
// TRUST_PROXY lets each simulated person arrive from their own address (X-Forwarded-For), as in production.
const env = { ...process.env, NODE_ENV: 'development', DATA_DIR, PORT: String(PORT), APP_URL: BASE, ADMIN_SIGNUP_CODE: ADMIN_CODE, TRUST_PROXY: '1', LUME_DEMO_MODE: 'on', DATABASE_URL: '', ANTHROPIC_API_KEY: '' };
const nodeArgs = ['--disable-warning=ExperimentalWarning'];

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passes++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failures++;
    console.log(`  \x1b[31m✗ ${label}\x1b[0m ${detail === undefined ? '' : JSON.stringify(detail).slice(0, 500)}`);
  }
}
const section = (t: string) => console.log(`\n${t}`);

let nextIp = 10;
class Browser {
  jar = new Map<string, string>();
  ip = `203.0.113.${nextIp++}`;
  cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  store(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i);
      const v = pair.slice(i + 1);
      if (/max-age=0/i.test(c) || v === '') this.jar.delete(k);
      else this.jar.set(k, v);
    }
  }
  async req(method: string, p: string, body?: unknown) {
    const res = await fetch(BASE + p, {
      method,
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', Origin: BASE, 'X-Lumera-Client': '1', Cookie: this.cookie(), 'X-Forwarded-For': this.ip },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.store(res);
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b: unknown = {}) => this.req('POST', p, b);
  patch = (p: string, b: unknown) => this.req('PATCH', p, b);
  put = (p: string, b: unknown) => this.req('PUT', p, b);
  del = (p: string) => this.req('DELETE', p);
  async visit(url: string) {
    const u = new URL(url);
    const res = await fetch(BASE + u.pathname + u.search, { redirect: 'manual', headers: { Cookie: this.cookie(), 'X-Forwarded-For': this.ip } });
    this.store(res);
    return { status: res.status, location: res.headers.get('location') };
  }
  async lume(message: string, extra: Record<string, unknown> = {}) {
    const res = await fetch(BASE + '/api/lume/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE, 'X-Lumera-Client': '1', Cookie: this.cookie(), 'X-Forwarded-For': this.ip },
      body: JSON.stringify({ message, page: 'dashboard', timezone: 'America/New_York', ...extra }),
    });
    const text = await res.text();
    if (res.headers.get('content-type')?.includes('application/json')) return { status: res.status, events: [] as any[], error: JSON.parse(text) };
    return { status: res.status, events: text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6))) };
  }
  /** Opens the live-update stream and collects change messages until stop() is called. */
  async listen() {
    const ctrl = new AbortController();
    const res = await fetch(BASE + '/api/stream', { headers: { Cookie: this.cookie(), 'X-Forwarded-For': this.ip }, signal: ctrl.signal });
    const changes: { topics: string[]; actorId: string | null }[] = [];
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let ready = false;
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            if (/^event: ready$/m.test(block)) ready = true;
            if (/^event: change$/m.test(block)) changes.push(JSON.parse(/^data: (.*)$/m.exec(block)![1]));
          }
        }
      } catch {
        /* aborted */
      }
    })();
    for (let n = 0; n < 40 && !ready; n++) await new Promise((r) => setTimeout(r, 25));
    return {
      status: res.status,
      changes,
      waitFor: async (topic: string) => {
        for (let n = 0; n < 40 && !changes.some((c) => c.topics.includes(topic)); n++) await new Promise((r) => setTimeout(r, 50));
        return changes.find((c) => c.topics.includes(topic)) ?? null;
      },
      stop: async () => {
        ctrl.abort();
        await pump;
      },
    };
  }
}

async function outbox(to: string, subject: string) {
  for (let i = 0; i < 20; i++) {
    const list = (await (await fetch(`${BASE}/api/dev/outbox`)).json()) as { to: string; subject: string; link: string }[];
    const m = list.find((x) => x.to === to && x.subject.includes(subject));
    if (m) return m;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`No email to ${to} (${subject})`);
}

async function signUp(b: Browser, name: string, email: string, password: string, extra: Record<string, unknown> = {}) {
  const r = await b.post('/api/auth/sign-up/email', { name, email, password, timezone: 'America/New_York', ...extra });
  if (r.status !== 200) throw new Error(`sign-up failed: ${JSON.stringify(r.data)}`);
}

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const add = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const nyTime = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

const proc: { server: ChildProcess | null } = { server: null };

async function main() {
  console.log(`Temporary database: ${DATA_DIR}`);
  const seed = spawnSync(process.execPath, [...nodeArgs, 'server/scripts/seed-demo.ts'], { cwd: ROOT, env, encoding: 'utf8' });
  if (seed.status !== 0) throw new Error(`Demo seed failed:\n${seed.stderr}`);

  const server = spawn(process.execPath, [...nodeArgs, 'server/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.server = server;
  let serverLog = '';
  server.stdout!.on('data', (d) => (serverLog += d));
  server.stderr!.on('data', (d) => (serverLog += d));
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
    if (i === 79) throw new Error(`Server did not start:\n${serverLog}`);
  }

  // ── 1. Creating an account signs you straight in; the admin code gives access ──
  section('1 · Sign-up and the admin code');
  const owner = new Browser();
  let r = await owner.post('/api/auth/sign-up/email', { name: 'Avery Stone', email: 'avery@lumera.test', password: 'short' });
  check('weak password rejected', r.status === 400, r.data);
  r = await owner.post('/api/auth/sign-up/email', { name: 'Avery Stone', email: 'avery@lumera.test', password: 'password123' });
  check('common password rejected', r.status === 400, r.data);
  r = await owner.post('/api/auth/sign-up/email', { name: 'Avery Stone', email: 'avery@lumera.test', password: 'tidal-harbor-lantern-42', admin: true, adminCode: '0000' });
  check('wrong admin code refused before any account is created', r.status === 403 && r.data.code === 'BAD_ADMIN_CODE', r.data);
  r = await owner.get('/api/me');
  check('…and nobody is signed in', r.status === 401, r.status);
  r = await owner.post('/api/auth/sign-up/email', { name: 'Avery Stone', email: 'avery@lumera.test', password: 'tidal-harbor-lantern-42', admin: true, adminCode: ADMIN_CODE, timezone: 'America/New_York' });
  check('admin sign-up accepted', r.status === 200, r.data);
  r = await owner.get('/api/me');
  check('signed in straight away, no email step or onboarding', r.status === 200 && r.data.profile.onboarded === true && r.data.profile.timezone === 'America/New_York', r.data);
  check('first admin creates Lumera Creative as its owner', r.data.workspace?.name === 'Lumera Creative' && r.data.workspace.role === 'owner' && r.data.workspace.isDemo === false, r.data.workspace);
  const ownerId = r.data.user.id;
  const orgId = r.data.workspace.id;
  r = await owner.post('/api/auth/sign-out');
  r = await owner.post('/api/auth/sign-in/email', { email: 'avery@lumera.test', password: 'tidal-harbor-lantern-42' });
  check('signs back in with email and password', r.status === 200, r.data);

  // ── 2. The business partner signs up with the same code and joins the same workspace ──
  section('2 · Business partner joins as admin');
  const partner = new Browser();
  await signUp(partner, 'Jordan Reyes', 'jordan@lumera.test', 'maple-orbit-canyon-19', { admin: true, adminCode: ADMIN_CODE });
  r = await partner.get('/api/me');
  check('partner lands in the same workspace as an admin', r.data.workspace?.id === orgId && r.data.workspace.role === 'admin', r.data.workspace);
  check('partner has admin permissions (profit, invites, exports)', ['finance.record', 'members.invite', 'data.export'].every((p) => r.data.workspace.permissions.includes(p)), r.data.workspace?.permissions);
  const partnerId = r.data.user.id;
  r = await owner.get('/api/members');
  check('both owners appear in the team', r.data.length === 2 && r.data.some((m: any) => m.id === partnerId && m.role === 'admin'), r.data);
  r = await owner.get('/api/notifications');
  check('owner is told the partner joined', r.data.items.some((n: any) => n.kind === 'admin_joined' && n.title.includes('Jordan')), r.data.items);

  const stranger = new Browser();
  await signUp(stranger, 'Sam Stranger', 'sam@elsewhere.test', 'quiet-meadow-anchor-31');
  r = await stranger.get('/api/me');
  check('sign-up without the code: signed in, but no company access', r.status === 200 && r.data.workspace === null && r.data.adminCodeAvailable === true, r.data);
  r = await stranger.get('/api/tasks');
  check('company data blocked without membership', r.status === 403 && r.data.error.code === 'no_workspace', r.data);
  for (let i = 0; i < 5; i++) r = await stranger.post('/api/me/admin-access', { code: String(1000 + i) });
  check('wrong admin codes refused', r.status === 403 && r.data.error.code === 'bad_admin_code', r.data);
  r = await stranger.post('/api/me/admin-access', { code: ADMIN_CODE });
  check('guessing locks the code out, even for the right code', r.status === 429 && r.data.error.code === 'admin_code_locked', r.data);

  // ── 2b. An invited team member joins through the emailed link ──
  section('2b · Invitation');
  r = await owner.post('/api/invitations', { email: 'maya@lumera.test', role: 'member' });
  check('invitation sent', r.status === 201, r.data);
  const token = (await outbox('maya@lumera.test', 'invited')).link.split('/invite/')[1];
  const maya = new Browser();
  r = await maya.get(`/api/invites/${token}`);
  check('invitation preview shows the workspace', r.data.orgName === 'Lumera Creative' && r.data.status === 'open', r.data);
  await signUp(maya, 'Maya Chen', 'maya@lumera.test', 'coral-summit-violet-7');
  r = await maya.get('/api/me');
  check('unconfirmed email does not reveal invitations', r.data.workspace === null && r.data.pendingInvitations.length === 0, r.data);
  const inviteId = (await owner.get('/api/invitations')).data.find((i: any) => i.email === 'maya@lumera.test')?.id;
  r = await maya.post(`/api/me/invitations/${inviteId}/accept`);
  check('accepting without the emailed link is refused', r.status === 403 && r.data.error.code === 'use_link', r.data);
  r = await maya.post(`/api/invites/${token}/accept`);
  check('invitation accepted through the link', r.status === 200, r.data);
  r = await maya.get('/api/me');
  check('joined Lumera Creative as member; email now confirmed', r.data.workspace?.name === 'Lumera Creative' && r.data.workspace.role === 'member' && r.data.user.emailVerified === true, r.data);
  r = await maya.post(`/api/invites/${token}/accept`);
  check('invitation cannot be reused', r.status === 410, r.data);
  const mayaId = (await maya.get('/api/me')).data.user.id;

  // ── 3. Project, tasks and events ──
  section('3 · Projects, tasks, events');
  r = await owner.post('/api/projects', { name: 'Harbor Dental website', newClientName: 'Harbor Dental', stage: 'discovery', status: 'active', leadId: mayaId, startDate: today, dueDate: add(today, 40), color: 'teal', templates: ['discovery'], idempotencyKey: 'e2e-project-1' });
  check('project with starter tasks', r.status === 201 && r.data.tasksCreated === 3, r.data);
  const projectId = r.data.project.id;
  r = await owner.post('/api/tasks', { title: 'Homepage wireframes', priority: 'high', dueDate: today, projectId, assigneeIds: [mayaId], checklist: ['Hero', 'Services'], idempotencyKey: 'e2e-task-1' });
  check('task created and assigned', r.status === 201, r.data);
  const task = r.data.task;
  r = await owner.post('/api/tasks', { title: 'Homepage wireframes', idempotencyKey: 'e2e-task-1' });
  check('double submit does not duplicate', r.status === 200 && r.data.duplicate === true, r.data);
  r = await owner.post('/api/events', { title: 'Weekly studio sync', date: today, startTime: '09:30', endTime: '10:00', timezone: 'America/New_York', attendeeIds: [mayaId], recurrence: { freq: 'weekly', interval: 1 }, reminderMinutes: 10, idempotencyKey: 'e2e-event-1' });
  check('recurring event scheduled', r.status === 201, r.data);
  const syncId = r.data.eventId;
  r = await owner.post('/api/events', { title: 'Harbor kickoff', date: add(today, 1), startTime: '14:00', endTime: '15:00', timezone: 'America/New_York', projectId, attendeeIds: [mayaId] });
  const kickoffId = r.data.eventId;
  r = await owner.post('/api/events', { title: 'Owner planning (private)', date: add(today, 1), startTime: '08:00', endTime: '08:30', timezone: 'America/New_York', visibility: 'private' });
  const privateId = r.data.eventId;

  // ── 4. Another member sees the shared data ──
  section('4 · Shared data');
  r = await maya.get('/api/tasks?view=mine');
  check('assignee sees the task', r.data.items.some((t: any) => t.id === task.id), r.data.items?.map((t: any) => t.title));
  r = await maya.get('/api/notifications');
  check('assignee was notified', r.data.items.some((n: any) => n.kind === 'task_assigned'), r.data.items);
  r = await maya.get(`/api/events?from=${today}&to=${add(today, 20)}&tz=America/New_York`);
  check('teammate sees team events', r.data.some((o: any) => o.eventId === kickoffId) && r.data.filter((o: any) => o.eventId === syncId).length >= 3, r.data.length);
  check('private events stay private', !r.data.some((o: any) => o.eventId === privateId));
  r = await maya.patch(`/api/tasks/${task.id}`, { changes: { status: 'in_progress' }, base: { status: 'todo' } });
  check('teammate updates status', r.status === 200 && r.data.status === 'in_progress', r.data);
  r = await owner.patch(`/api/tasks/${task.id}`, { changes: { status: 'review' }, base: { status: 'todo' } });
  check('stale edit of the same field is refused (409), not silently overwritten', r.status === 409 && r.data.error.details.conflicts[0].field === 'status', r.data);

  // ── 4b. The two owners see each other's work, labelled with who added it ──
  section('4b · Collaboration between the owners');
  const demo0 = new Browser();
  await demo0.post('/api/auth/sign-in/email', { email: 'avery@demo.lumera.test', password: process.env.DEMO_PASSWORD ?? 'studio-demo-2026' });
  r = await partner.get('/api/tasks?view=team');
  const seen = r.data.items.find((t: any) => t.id === task.id);
  check('partner sees the owner’s task, labelled as added by the owner', seen?.createdBy === ownerId, seen);
  r = await partner.post('/api/tasks', { title: 'Draft Harbor proposal', dueDate: add(today, 2), assigneeIds: [ownerId], idempotencyKey: 'e2e-partner-task' });
  const partnerTask = r.data.task;
  r = await owner.get('/api/tasks?view=mine');
  check('owner sees the partner’s task, labelled as added by the partner', r.data.items.some((t: any) => t.id === partnerTask.id && t.createdBy === partnerId), r.data.items?.map((t: any) => [t.title, t.createdBy]));
  r = await partner.post('/api/events', { title: 'Coffee with Harbor', date: add(today, 2), startTime: '10:00', endTime: '10:45', timezone: 'America/New_York', idempotencyKey: 'e2e-partner-event' });
  const partnerEventId = r.data.eventId;
  r = await owner.get(`/api/events?from=${today}&to=${add(today, 7)}&tz=America/New_York`);
  check('partner’s calendar event shows for the owner, labelled with the partner', r.data.some((o: any) => o.eventId === partnerEventId && o.createdBy === partnerId), r.data.map((o: any) => [o.title, o.createdBy]));
  check('owner’s events are labelled with the owner', r.data.filter((o: any) => o.eventId === kickoffId).every((o: any) => o.createdBy === ownerId));

  const live = await owner.listen();
  check('live update stream opens', live.status === 200, live.status);
  r = await partner.post('/api/notes', { title: 'Harbor pitch ideas', body: 'Lead with the booking flow.\nShow before/after speed.', idempotencyKey: 'e2e-note-1' });
  check('partner writes a shared note', r.status === 201 && r.data.createdBy === partnerId, r.data);
  const note = r.data;
  const msg = await live.waitFor('notes');
  check('owner’s open app is told about the new note instantly', msg?.actorId === partnerId, live.changes);
  await live.stop();
  r = await partner.post('/api/notes', { title: 'Harbor pitch ideas', body: 'Lead with the booking flow.\nShow before/after speed.', idempotencyKey: 'e2e-note-1' });
  check('a double-submitted note is saved once', r.data.id === note.id, r.data);
  r = await owner.get('/api/notes');
  check('owner sees the partner’s note with their name on it', r.data.length === 1 && r.data[0].createdBy === partnerId, r.data);
  r = await owner.patch(`/api/notes/${note.id}`, { version: note.version, body: note.body + '\nAdd the Google reviews.' });
  check('owner edits it; the note records who edited it', r.status === 200 && r.data.updatedBy === ownerId && r.data.createdBy === partnerId && r.data.version === 2, r.data);
  r = await partner.patch(`/api/notes/${note.id}`, { version: note.version, body: 'overwrite' });
  check('stale edit is refused (409) with the latest version, never silently overwritten', r.status === 409 && r.data.error.details.note.updatedBy === ownerId, r.data);
  r = await maya.get('/api/notes');
  check('team members see shared notes too', r.data.length === 1, r.data);
  r = await maya.del(`/api/notes/${note.id}`);
  check('members cannot delete someone else’s note', r.status === 403, r.data);
  r = await maya.post('/api/notes', { title: '', body: '   ' });
  check('empty note rejected', r.status === 422, r.data);
  r = await owner.post('/api/notes', { title: 'Scratch', body: 'temp' });
  r = await owner.del(`/api/notes/${r.data.id}`);
  check('author can delete their note', r.status === 200, r.data);
  r = await owner.get('/api/activity');
  check('activity shows who added the note', r.data.items.some((a: any) => a.entityType === 'note' && a.actorId === partnerId && a.verb === 'created'), r.data.items?.slice(0, 5));
  r = await demo0.get('/api/notes');
  check('notes from another workspace stay invisible', r.status === 200 && !r.data.some((n: any) => n.id === note.id), r.data);

  // ── 5. Profit and the monthly goal ──
  section('5 · Profit');
  r = await owner.get('/api/profit');
  check('default $500 target', r.data.summary.targetCents === 50000, r.data.summary);
  await owner.post('/api/profit/entries', { amountCents: 32050, entryDate: today, projectId, note: 'Deposit', idempotencyKey: 'e2e-profit-1' });
  r = await owner.post('/api/profit/entries', { amountCents: 32050, entryDate: today, idempotencyKey: 'e2e-profit-1' });
  check('same submission is not recorded twice', r.status === 200 && r.data.duplicate === true, r.data);
  r = await owner.post('/api/profit/entries', { amountCents: 32050, entryDate: today, idempotencyKey: 'e2e-profit-2' });
  check('likely duplicate asks for confirmation', r.status === 409 && r.data.error.code === 'possible_duplicate', r.data);
  await owner.post('/api/profit/entries', { amountCents: -5000, entryDate: today, note: 'Refund', idempotencyKey: 'e2e-profit-3' });
  await owner.post('/api/profit/entries', { amountCents: 40000, entryDate: today, idempotencyKey: 'e2e-profit-4' });
  r = await owner.get('/api/profit');
  check('totals from saved entries: $670.50 = 134% (over target)', r.data.summary.recordedCents === 67050 && r.data.summary.percent === 134 && r.data.summary.overCents === 17050, r.data.summary);
  const lastMonth = add(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  await owner.post('/api/profit/entries', { amountCents: 12000, entryDate: `${lastMonth}-15`, idempotencyKey: 'e2e-profit-5' });
  r = await owner.put('/api/profit/target', { month: today.slice(0, 7), targetCents: 75000 });
  check('target changed for this month', r.data.targetCents === 75000, r.data);
  r = await owner.get(`/api/profit?month=${lastMonth}`);
  check('previous month keeps its entries and target', r.data.summary.recordedCents === 12000 && r.data.summary.targetCents === 50000, r.data.summary);

  // ── 6. Lume reads permitted records and performs a confirmed action ──
  section('6 · Lume');
  let chat = await maya.lume('What should I focus on today?');
  const done = chat.events.find((e) => e.type === 'done');
  check('streamed answer (start → delta → done)', chat.events[0]?.type === 'start' && chat.events.some((e) => e.type === 'delta') && Boolean(done), chat.events.map((e) => e.type));
  check('answer links real records and says when data was retrieved', done?.message.refs.length > 0 && Boolean(done?.message.retrievedAt), done?.message);
  check('demo responses are labelled', done?.message.demo === true);
  const conversationId = chat.events[0].conversationId;
  chat = await maya.lume('How close are we to our monthly profit goal?', { conversationId });
  const profitText = chat.events.find((e) => e.type === 'done')?.message.text ?? '';
  check('profit answer uses app-calculated figures', profitText.includes('$670.50') && profitText.includes('$750'), profitText);
  chat = await maya.lume('Create a task “Send Harbor proposal” tomorrow', { conversationId });
  const action = chat.events.find((e) => e.type === 'action')?.action;
  check('change is proposed, not saved', action?.status === 'proposed', chat.events.map((e) => e.type));
  r = await owner.get('/api/tasks?view=team&q=Send%20Harbor');
  check('nothing saved before confirmation', r.data.items.length === 0, r.data.items);
  r = await owner.post(`/api/lume/actions/${action.id}/confirm`, {});
  check('only the person who asked can confirm', r.status === 404, r.data);
  r = await maya.post(`/api/lume/actions/${action.id}/confirm`, {});
  check('confirmed action saved with a link', r.data.status === 'confirmed' && r.data.result.refs[0].type === 'task', r.data);
  const again = await maya.post(`/api/lume/actions/${action.id}/confirm`, {});
  check('confirming twice does not duplicate', again.data.result.refs[0].id === r.data.result.refs[0].id);
  chat = await maya.lume('Schedule a meeting “Planning” on friday', { conversationId });
  check('asks a clarifying question when the time is missing', /what time/i.test(chat.events.find((e) => e.type === 'done')?.message.text ?? '') && !chat.events.some((e) => e.type === 'action'));
  r = await maya.get('/api/lume/briefing');
  check('personal briefing: facts + suggested priorities', r.status === 200 && Array.isArray(r.data.facts.meetings) && r.data.priorities.length > 0, r.data);
  r = await maya.get('/api/lume/briefing?scope=team');
  check('team briefing restricted to owners/admins', r.status === 403);

  // ── 7. Refreshing or signing back in preserves the data ──
  section('7 · Persistence');
  await maya.post('/api/auth/sign-out');
  r = await maya.get('/api/me');
  check('signed out', r.status === 401);
  r = await maya.post('/api/auth/sign-in/email', { email: 'maya@lumera.test', password: 'coral-summit-violet-7' });
  check('signed back in', r.status === 200, r.data);
  r = await maya.get('/api/tasks?view=team&q=Send%20Harbor');
  check('Lume-created task persisted', r.data.items.length === 1 && r.data.items[0].source === 'lume', r.data.items);
  r = await maya.get(`/api/lume/conversations/${conversationId}`);
  check('conversation history persisted', r.status === 200 && r.data.messages.length >= 8, r.data.messages?.length);
  r = await owner.get(`/api/lume/conversations/${conversationId}`);
  check('other people cannot read it', r.status === 404);
  r = await maya.del(`/api/lume/conversations/${conversationId}`);
  check('conversation can be deleted', r.status === 200 && (await maya.get(`/api/lume/conversations/${conversationId}`)).status === 404);

  // ── 8. Unauthorized access ──
  section('8 · Permissions and isolation');
  r = await maya.get('/api/profit');
  check('member sees goal totals only', r.status === 200 && r.data.entries === null);
  r = await maya.post('/api/profit/entries', { amountCents: 100, entryDate: today, idempotencyKey: 'e2e-maya-profit' });
  check('member cannot record profit', r.status === 403);
  r = await maya.put('/api/profit/target', { month: today.slice(0, 7), targetCents: 100 });
  check('member cannot change the target', r.status === 403);
  r = await maya.get('/api/export/workspace.json');
  check('member cannot export', r.status === 403);
  r = await partner.get('/api/export/workspace.json');
  check('admin export includes shared notes', r.status === 200 && r.data.notes?.length === 1 && r.data.notes[0].createdBy === partnerId, r.data.notes);
  r = await maya.get('/api/activity');
  check('financial activity hidden from members', !r.data.items.some((a: any) => a.entityType === 'profit'));
  r = await maya.post('/api/invitations', { email: 'x@lumera.test', role: 'admin' });
  check('member cannot invite', r.status === 403);
  r = await owner.patch('/api/workspace', { membersSeeProfit: false });
  r = await maya.get('/api/profit');
  check('owner can hide profit totals from members', r.status === 403);
  const demo = new Browser();
  r = await demo.post('/api/auth/sign-in/email', { email: 'avery@demo.lumera.test', password: process.env.DEMO_PASSWORD ?? 'studio-demo-2026' });
  check('demo workspace user signs in', r.status === 200, r.data);
  r = await demo.get(`/api/tasks/${task.id}`);
  check('another workspace cannot read this task', r.status === 404, r.data);
  r = await demo.get(`/api/projects/${projectId}`);
  check('another workspace cannot read this project', r.status === 404, r.data);
  r = await demo.post('/api/me/active-workspace', { orgId: (await owner.get('/api/me')).data.workspace.id });
  check('cannot switch into a workspace without membership', r.status === 403, r.data);
  const crossSite = await fetch(`${BASE}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: owner.cookie(), Origin: 'https://evil.example' }, body: '{"title":"x"}' });
  check('cross-site write blocked', crossSite.status === 403);

  // ── Password reset ──
  section('Password reset');
  r = await maya.post('/api/auth/request-password-reset', { email: 'maya@lumera.test', redirectTo: '/reset-password' });
  check('reset requested', r.status === 200, r.data);
  const resetLink = (await outbox('maya@lumera.test', 'Reset')).link;
  const resetRedirect = await new Browser().visit(resetLink);
  const resetToken = new URL(resetRedirect.location ?? '', BASE).searchParams.get('token');
  check('reset link redirects with a token', Boolean(resetToken), resetRedirect);
  r = await new Browser().post('/api/auth/reset-password', { newPassword: 'password123', token: resetToken });
  check('weak new password refused', r.status === 400, r.data);
  r = await new Browser().post('/api/auth/reset-password', { newPassword: 'amber-forest-kite-58', token: resetToken });
  check('password reset', r.status === 200, r.data);
  r = await maya.get('/api/me');
  check('other sessions signed out after reset', r.status === 401, r.status);
  r = await new Browser().post('/api/auth/sign-in/email', { email: 'maya@lumera.test', password: 'amber-forest-kite-58' });
  check('sign in with the new password', r.status === 200, r.data);

  // ── Time zones, DST, recurrence, failures ──
  section('Time zones, recurrence and failures');
  r = await owner.get(`/api/events?from=2026-10-20&to=2026-11-20&tz=America/New_York`);
  const dst = r.data.filter((o: any) => o.eventId === syncId);
  check('weekly 09:30 stays 09:30 local across the DST change', dst.length >= 4 && dst.every((o: any) => nyTime(o.startsAt) === '09:30'), dst.map((o: any) => o.startsAt));
  check('…while its UTC time shifts by an hour', new Set(dst.map((o: any) => o.startsAt.slice(11, 16))).size === 2);
  r = await owner.get(`/api/events?from=${today}&to=${add(today, 20)}&tz=Asia/Tokyo`);
  check('events can be read in another viewer time zone', r.status === 200 && r.data.length > 0);
  r = await owner.get(`/api/events?from=${today}&to=${add(today, 30)}&tz=America/New_York`);
  const occ = r.data.filter((o: any) => o.eventId === syncId);
  const series = (await owner.get(`/api/events/${syncId}`)).data;
  r = await owner.put(`/api/events/${syncId}`, { scope: 'occurrence', occurrenceKey: occ[1].occurrenceKey, version: series.version, event: { title: 'Studio sync (moved)', date: occ[1].startsAt.slice(0, 10), startTime: '11:00', endTime: '11:30', timezone: 'America/New_York' } });
  check('edit one occurrence', r.status === 200, r.data);
  r = await owner.put(`/api/events/${syncId}`, { scope: 'series', version: series.version, event: { title: 'stale', date: today, startTime: '09:30', endTime: '10:00', timezone: 'America/New_York' } });
  check('stale series edit refused (409)', r.status === 409, r.data);
  r = await owner.get(`/api/events?from=${today}&to=${add(today, 30)}&tz=America/New_York`);
  const after = r.data.filter((o: any) => o.eventId === syncId);
  check('only that occurrence moved', nyTime(after.find((o: any) => o.key === occ[1].key).startsAt) === '11:00' && after.filter((o: any) => o.key !== occ[1].key).every((o: any) => nyTime(o.startsAt) === '09:30'));
  r = await owner.del(`/api/events/${syncId}?scope=occurrence&occurrence=${encodeURIComponent(occ[2].occurrenceKey)}`);
  r = await owner.get(`/api/events?from=${today}&to=${add(today, 30)}&tz=America/New_York`);
  check('cancel one occurrence', !r.data.some((o: any) => o.key === occ[2].key) && r.data.some((o: any) => o.key === occ[3].key));
  r = await owner.post('/api/events', { title: 'Bad', date: today, startTime: '10:00', endTime: '09:00', timezone: 'America/New_York' });
  check('invalid input rejected with a field message', r.status === 422 && Boolean(r.data.error.fields?.endTime), r.data);
  r = await owner.post('/api/tasks', { title: '' });
  check('empty task title rejected', r.status === 422, r.data);
  r = await owner.get('/api/tasks/00000000-0000-0000-0000-000000000000');
  check('missing record → 404 with a message', r.status === 404 && typeof r.data.error.message === 'string');
}

try {
  await main();
} catch (err) {
  failures++;
  console.error('\n\x1b[31mTest run aborted:\x1b[0m', err);
} finally {
  proc.server?.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 600));
  rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}
