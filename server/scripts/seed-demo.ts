// Creates a separate, clearly labelled DEMO workspace with sample people,
// clients, projects, tasks, events and profit — for trying the product.
// It never touches your real workspace. Refuses to run in production.
//
//   npm run seed:demo            # create the demo workspace (once)
//   npm run seed:demo -- --reset # delete and recreate it
//
// Demo sign-ins use the password in DEMO_PASSWORD (default printed below).
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, like } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { isProd } from '../env.ts';
import { closeDb, db, schema } from '../db/client.ts';
import { createWorkspace } from '../services/workspace.ts';
import { createTask, updateTask, addComment, type Actor } from '../services/tasks.ts';
import { createClient, createProject } from '../services/projects.ts';
import { createEvent, type EventInput } from '../services/events.ts';
import { createEntry } from '../services/profit.ts';
import { addDays, addMonths, monthKey, todayIn, weekday } from '../../shared/dates.ts';

if (isProd) {
  console.error('The demo seed is for development only. It will not run with NODE_ENV=production.');
  process.exit(1);
}

const TZ = 'America/New_York';
const DOMAIN = 'demo.lumera.test';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'studio-demo-2026';
const reset = process.argv.includes('--reset');

const PEOPLE = [
  { key: 'avery', name: 'Avery Stone', title: 'Founder & strategist', role: 'owner' as const },
  { key: 'maya', name: 'Maya Chen', title: 'Design lead', role: 'admin' as const },
  { key: 'theo', name: 'Theo Park', title: 'Developer', role: 'member' as const },
  { key: 'sam', name: 'Sam Rivera', title: 'Marketing specialist', role: 'member' as const },
];

async function removeExisting() {
  const orgs = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.isDemo, true));
  if (orgs.length) await db.delete(schema.organizations).where(inArray(schema.organizations.id, orgs.map((o) => o.id)));
  await db.delete(schema.user).where(like(schema.user.email, `%@${DOMAIN}`));
}

async function main() {
  const [existing] = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.isDemo, true));
  if (existing && !reset) {
    console.log('A demo workspace already exists. Run with --reset to recreate it.');
    return;
  }
  if (reset) await removeExisting();

  // People (verified, onboarded, with passwords hashed exactly as Better Auth does).
  const hash = await hashPassword(PASSWORD);
  const ids: Record<string, string> = {};
  for (const p of PEOPLE) {
    const id = randomUUID().replace(/-/g, '').slice(0, 32);
    ids[p.key] = id;
    await db.insert(schema.user).values({ id, name: p.name, email: `${p.key}@${DOMAIN}`, emailVerified: true });
    await db.insert(schema.account).values({ id: randomUUID(), accountId: id, providerId: 'credential', userId: id, password: hash });
    await db.insert(schema.profiles).values({ userId: id, jobTitle: p.title, timezone: TZ, onboardedAt: new Date() }).onConflictDoNothing();
    await db.insert(schema.notificationPreferences).values({ userId: id }).onConflictDoNothing();
  }

  const org = await createWorkspace(ids.avery, { name: 'Lumera Creative (Demo)', timezone: TZ, isDemo: true });
  for (const p of PEOPLE.slice(1)) {
    await db.insert(schema.memberships).values({ orgId: org.id, userId: ids[p.key], role: p.role });
    await db.update(schema.profiles).set({ activeOrgId: org.id }).where(eq(schema.profiles.userId, ids[p.key]));
  }
  const actor = (key: string): Actor => ({ orgId: org.id, userId: ids[key], userName: PEOPLE.find((p) => p.key === key)!.name, canDeleteAny: key === 'avery' || key === 'maya' });

  const today = todayIn(TZ);
  const d = (n: number) => addDays(today, n);

  // Clients & projects.
  const harborClient = await createClient(actor('avery'), { name: 'Harbor Dental', contactName: 'Dr. Lena Ortiz', contactEmail: 'lena@harbor-dental.example', website: 'harbor-dental.example', status: 'active', notes: 'Two-location practice. Wants online booking and a warmer brand.' });
  const northwind = await createClient(actor('avery'), { name: 'Northwind Coffee Co.', contactName: 'Jonah Pike', contactEmail: 'jonah@northwind.example', website: 'northwind.example', status: 'active' });
  const juniper = await createClient(actor('avery'), { name: 'Juniper Legal', contactName: 'Priya Nair', contactEmail: 'priya@juniperlegal.example', status: 'active', notes: 'Monthly SEO retainer.' });
  await createClient(actor('avery'), { name: 'Fieldstone Realty', contactName: 'Marcus Webb', status: 'lead', notes: 'Intro call went well — waiting on budget.' });

  const harbor = await createProject(actor('avery'), TZ, { name: 'Harbor Dental website', clientId: harborClient.id, stage: 'design', status: 'active', leadId: ids.maya, startDate: d(-8), dueDate: d(30), color: 'teal', templates: ['discovery', 'design'], description: 'Redesign with online booking, service pages for both locations, and local SEO foundations.' });
  const nw = await createProject(actor('avery'), TZ, { name: 'Northwind Shopify relaunch', clientId: northwind.id, stage: 'development', status: 'active', leadId: ids.theo, startDate: d(-30), dueDate: d(10), color: 'amber', templates: [], description: 'Theme rebuild, subscription checkout and product photography refresh.' });
  const seo = await createProject(actor('avery'), TZ, { name: 'Juniper Legal SEO retainer', clientId: juniper.id, stage: 'marketing', status: 'active', leadId: ids.sam, startDate: d(-27), color: 'slate', templates: ['marketing'] });
  await createProject(actor('avery'), TZ, { name: 'Fieldstone discovery', stage: 'discovery', status: 'planned', leadId: ids.avery, color: 'rose', templates: [] });

  // Move Harbor's discovery tasks to done so the project shows progress.
  const harborTasks = await db.select().from(schema.tasks).where(eq(schema.tasks.projectId, harbor.project.id));
  for (const t of harborTasks.filter((x) => ['Kickoff call with client', 'Collect brand assets and access', 'Draft sitemap and scope'].includes(x.title))) {
    await updateTask(actor('maya'), t.id, { status: 'done' }, {});
  }

  // Tasks with a realistic spread of due dates and states.
  const mk = async (who: string, input: Parameters<typeof createTask>[1]) => (await createTask(actor(who), input)).task;
  const qa = await mk('theo', { title: 'Launch QA pass on staging', priority: 'high', dueDate: today, dueTime: '16:00', projectId: nw.project.id, assigneeIds: [ids.theo], checklist: ['Checkout with subscription', 'Mobile product pages', 'Email receipts', 'Redirects from old URLs'] });
  await mk('theo', { title: 'Fix cart drawer on Safari', priority: 'high', dueDate: d(-2), projectId: nw.project.id, assigneeIds: [ids.theo], description: 'Drawer closes immediately on iOS Safari 18 when tapping quantity.' });
  await mk('avery', { title: 'Send Northwind launch-day plan', priority: 'medium', dueDate: d(1), projectId: nw.project.id, assigneeIds: [ids.avery] });
  const wire = await mk('maya', { title: 'Homepage wireframes for Harbor review', priority: 'high', dueDate: today, projectId: harbor.project.id, assigneeIds: [ids.maya], status: 'in_progress' });
  await mk('maya', { title: 'Booking flow prototype', priority: 'medium', dueDate: d(4), projectId: harbor.project.id, assigneeIds: [ids.maya, ids.theo] });
  await mk('sam', { title: 'September SEO report for Juniper', priority: 'medium', dueDate: d(-1), projectId: seo.project.id, assigneeIds: [ids.sam], status: 'review' });
  await mk('sam', { title: 'Keyword plan for practice-area pages', priority: 'low', dueDate: d(6), projectId: seo.project.id, assigneeIds: [ids.sam] });
  await mk('avery', { title: 'Proposal for Fieldstone Realty', priority: 'high', dueDate: d(3), assigneeIds: [ids.avery], checklist: ['Scope options', 'Timeline', 'Pricing'] });
  await mk('avery', { title: 'Update studio portfolio with Northwind', priority: 'low', dueDate: d(14), assigneeIds: [ids.maya] });
  await mk('sam', { title: 'Draft Q4 content calendar', priority: 'medium', assigneeIds: [ids.sam] });

  await addComment(actor('maya'), wire.id, 'Two directions ready: “calm clinical” and “warm neighbourhood”. Leaning warm — booking CTA is stronger.');
  await addComment(actor('avery'), wire.id, 'Agree on warm. Let’s show both but recommend that one.');
  await addComment(actor('theo'), qa.id, 'Subscription checkout passes on desktop; testing mobile after lunch.');

  // Events: a weekly sync, client meetings, a launch day, a private 1:1.
  const ev = (who: string, e: Partial<EventInput> & Pick<EventInput, 'title' | 'date'>) =>
    createEvent(actor(who), { description: '', location: '', allDay: false, timezone: TZ, projectId: null, attendeeIds: [], visibility: 'team', reminderMinutes: 10, recurrence: null, ...e });
  const monday = d(-((weekday(today) + 6) % 7));
  await ev('avery', { title: 'Studio sync', date: monday, startTime: '09:30', endTime: '10:00', attendeeIds: Object.values(ids), recurrence: { freq: 'weekly', interval: 1 }, location: 'Studio / video call', description: 'Priorities, blockers, client updates.' });
  await ev('maya', { title: 'Harbor design review', date: d(1), startTime: '14:00', endTime: '15:00', projectId: harbor.project.id, attendeeIds: [ids.maya, ids.avery], location: 'https://meet.example/harbor' });
  await ev('theo', { title: 'Northwind QA walkthrough', date: today, startTime: '15:00', endTime: '15:45', projectId: nw.project.id, attendeeIds: [ids.theo, ids.avery] });
  await ev('theo', { title: 'Northwind launch day', date: d(10), allDay: true, endDate: d(10), projectId: nw.project.id, attendeeIds: [ids.theo, ids.avery, ids.sam], reminderMinutes: null });
  await ev('sam', { title: 'Juniper monthly SEO call', date: d(5), startTime: '11:00', endTime: '11:30', projectId: seo.project.id, attendeeIds: [ids.sam], recurrence: { freq: 'monthly', interval: 1 } });
  await ev('avery', { title: 'Avery / Maya 1:1', date: d(2), startTime: '10:30', endTime: '11:00', attendeeIds: [ids.avery, ids.maya], visibility: 'private' });
  await ev('avery', { title: 'Fieldstone intro follow-up', date: today, startTime: '11:30', endTime: '12:00', attendeeIds: [ids.avery] });

  // Profit: this month partway to the $500 goal; previous months intact.
  const month = monthKey(today);
  const inMonth = (day: number) => `${month}-${String(Math.min(day, Number(today.slice(8)))).padStart(2, '0')}`;
  const entry = (amountCents: number, entryDate: string, extra: Partial<Parameters<typeof createEntry>[1]> = {}) =>
    createEntry(actor('avery'), { amountCents, entryDate, clientId: null, projectId: null, note: '', idempotencyKey: randomUUID(), confirmDuplicate: true, ...extra });
  await entry(18000, inMonth(3), { clientId: harborClient.id, projectId: harbor.project.id, note: 'Discovery phase, net of stock licences' });
  await entry(14000, inMonth(8), { clientId: juniper.id, projectId: seo.project.id, note: 'Monthly retainer margin' });
  await entry(-2500, inMonth(9), { note: 'Refund — duplicate hosting charge' });
  const prev = addMonths(month, -1);
  await entry(26000, `${prev}-06`, { clientId: northwind.id, projectId: nw.project.id, note: 'Development milestone 1' });
  await entry(14000, `${prev}-12`, { clientId: juniper.id, projectId: seo.project.id, note: 'Monthly retainer margin' });
  await entry(12500, `${prev}-24`, { note: 'Landing page for a referral client' });
  const prev2 = addMonths(month, -2);
  await entry(14000, `${prev2}-10`, { clientId: juniper.id, projectId: seo.project.id, note: 'Monthly retainer margin' });
  await entry(22000, `${prev2}-21`, { clientId: northwind.id, projectId: nw.project.id, note: 'Deposit' });

  await db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.orgId, org.id)));

  console.log(`\nDemo workspace ready: “${org.name}” (labelled as demo in the app).`);
  console.log('Sign in with any of these (password below):');
  for (const p of PEOPLE) console.log(`  ${`${p.key}@${DOMAIN}`.padEnd(26)} ${p.role}`);
  console.log(`  Password: ${PASSWORD}${process.env.DEMO_PASSWORD ? ' (from DEMO_PASSWORD)' : ''}\n`);
}

try {
  await main();
} finally {
  await closeDb();
}
process.exit(0);
