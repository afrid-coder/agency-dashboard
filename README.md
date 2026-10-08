# Lumera Creative — workspace

The internal workspace for Lumera Creative, a website development and digital marketing agency: a shared calendar, clients and projects, tasks, the **$500 monthly profit goal**, and **Lume**, the agency's AI assistant (powered by Anthropic's Claude).

- **Stack:** React 19 + Vite · Hono on Node 24 (TypeScript run directly) · PostgreSQL via Drizzle ORM with SQL migrations · Better Auth · Anthropic TypeScript SDK · TanStack Query · GSAP + Lenis (front page only).
- **Data:** PostgreSQL in production. Local development uses an embedded PostgreSQL (PGlite) in `data/pg`, so no database install is needed.

---

## Quick start (development)

Requirements: **Node 24+**.

```bash
npm install
npm run dev
```

Site live at : https://afrid-coder.github.io/agency-dashboard/


### Try it with sample data

```bash
# stop the dev server first — the embedded database is single-process
npm run seed:demo            # add -- --reset to recreate it
npm run dev
```

This creates a separate workspace named **“Lumera Creative (Demo)”**. It is labelled as a demo throughout the app and never mixed with your real workspace. Sign in as `avery@demo.lumera.test` (owner), `maya@…` (admin), `theo@…` or `sam@…` (members). The password is `studio-demo-2026`, or whatever you set in `DEMO_PASSWORD`.

### Create the real workspace (the two business owners)


---

## Accounts and access

- **Sign-up:** name, email and password (at least 10 characters, common passwords refused). You're signed in immediately; there is no email-confirmation step, and your time zone is taken from the browser. Passwords are hashed with scrypt by **Better Auth**. Sessions are database-backed httpOnly cookies lasting 14 days, and you can review or revoke them in **Settings → Security**. Password reset links work once, for one hour, and sign out every other session.
- **Signing up grants no access to company data.** Access comes only from:
  - **The admin code**, for the business owners. It is checked before the account is created. Wrong guesses are limited to 5 per address per 15 minutes and 12 overall per hour, so the four digits can't be tried one by one.
  - **An invitation**, for everyone else. Because addresses aren't confirmed at sign-up, an invitation is accepted only through the link emailed to that address. Opening the link also marks the email as confirmed.
- Anyone without access sees the pending-access screen.
- **Quick-unlock PIN (optional):** a four-digit PIN can unlock a session that locked after inactivity. It can never sign anyone in. It is hashed with scrypt and peppered with the server secret. Five wrong PINs end the session.

| Permission | Owner | Admin | Member |
|---|:-:|:-:|:-:|
| Calendar, clients, projects, tasks, team notes (create, edit) | ✓ | ✓ | ✓ |
| Delete other people's notes | ✓ | ✓ | — |
| Delete other people's tasks, delete projects/clients | ✓ | ✓ | — |
| See monthly goal progress (totals) | ✓ | ✓ | if allowed in workspace settings |
| See, record, edit or delete profit entries; change the target | ✓ | ✓ | — |
| Team briefing in Lume | ✓ | ✓ | — |
| Invite people, change roles (not owners), remove members | ✓ | ✓ | — |
| Grant or remove the owner role | ✓ | — | — |
| Workspace settings, data export | ✓ | ✓ | — |

The server checks these permissions on every request, Lume's included. Private events are visible only to their organizer and attendees.

## Working together

- **Everything is shared.** Everyone in the workspace sees the same calendar, tasks, projects and notes. Changes appear on everyone's screen within a second through live updates, with no refresh needed.
- **Everything is labelled.**
  - Tasks and calendar events show who added them: in task rows and on the board, calendar chips, the agenda and the dashboard, and in full in the task panel and event details.
  - Notes show who wrote them and who last edited them.
  - The activity feed names who did what.
- **Team notes** (the **Notes** page and a dashboard card) hold ideas, call notes and reminders.
  - Anyone can write or edit a note, and can pin one to the top.
  - Only the author, or an owner or admin, can delete a note.
  - If two people edit the same note at once, the second save is stopped and offers *Load their version* or *Save mine instead*.
  - Lume can search notes too.

---

## Lume (Anthropic API)

Set these on the **server** only:

```bash
ANTHROPIC_API_KEY=sk-ant-...
LUME_MODEL=claude-opus-5        # any Claude model id
```

- **What it does:**
  - Gives a daily briefing (personal, or team for owners and admins).
  - Streams chat answers.
  - Reads permitted records through backend tools: tasks, calendar, projects, clients, team, and the profit goal.
  - **Proposes** new tasks, task updates, events and task lists. Each proposal shows a preview with **Confirm / Edit / Cancel**, and the server writes nothing until it is confirmed.
  - On confirmation, the same services and permissions as the rest of the app run, with an idempotency key so a double click can't create a second copy.
  - Event proposals are checked for attendee conflicts, and task proposals for duplicates.
- **Grounding:**
  - Record links in answers are validated against the records actually retrieved for that person.
  - Money figures come only from the app's own calculations of recorded profit, and briefing text that mentions any other amount is dropped.
  - Suggestions and estimates are labelled.
  - Answers show which data sources were used and when they were retrieved.
- **Limits:**
  - `LUME_REQUESTS_PER_MINUTE` and `LUME_DAILY_REQUESTS_PER_USER` apply per person.
  - `LUME_MONTHLY_TOKEN_BUDGET` applies per workspace.
  - Input is capped at 4,000 characters and output at `LUME_MAX_OUTPUT_TOKENS`.
  - Timeouts, rate limits and outages from the API show a clear message with **Retry**.
- **Privacy:** the records relevant to a request are sent to Anthropic to answer it, and the app says so wherever you use Lume. Conversations are stored per person, and each person can delete one or all of them.
- **Without a key:**
  - In **development**, Lume runs in a *demo mode*: scripted answers built from your real records through the same tools and confirmation flow. Every answer is labelled “Demo response”.
  - In **production**, Lume shows a “not connected” setup state. It never substitutes sample answers.

---

## Email

Configure **one** provider. Without one, production starts with a warning, and password-reset and invitation emails can't be sent.

```bash
MAIL_FROM="Lumera Creative <workspace@your-domain.com>"
RESEND_API_KEY=re_...                               # or:
SMTP_URL=smtps://user:pass@smtp.example.com:465
```

Email is used for password reset and invitations, plus an optional email when someone is assigned a task. Reminders and other notifications appear in the app.

---

## Database and migrations

- The schema lives in `server/db/schema.ts`. It covers:
  - users, profiles, organizations, memberships and invitations
  - clients and projects
  - shared team notes
  - tasks, with assignees, checklist subtasks and comments
  - events, with attendees and single-occurrence exceptions
  - profit entries and monthly goals
  - Lume conversations, messages, actions, briefings and usage
  - notifications and activity history
- Foreign keys, CHECK constraints and partial unique indexes enforce integrity. Money is stored as integer cents and timestamps as `timestamptz`.
- SQL migrations are committed in `server/db/migrations`.
  - After changing the schema: `npm run db:generate`, then review the new SQL file.
  - Migrations run automatically when the server starts. `npm run db:migrate` runs them on their own, for deploy pipelines.
- Dates are handled as follows:
  - Due dates, profit dates and all-day events are calendar dates.
  - Timed events are stored as UTC instants plus the time zone they were scheduled in. Recurring meetings therefore keep their local time across daylight-saving changes.
  - Each person sees times in their own time zone, set during onboarding.

---

## Backups and recovery

**Automated backups come from your PostgreSQL provider.** Turn them on before going live:

- **Render Postgres** (used by `render.yaml`): paid plans include daily backups and point-in-time recovery. Restore from the database's *Recovery* tab to a new instance, then point `DATABASE_URL` at it.
- **Neon:** point-in-time restore (“branching”) is on by default. Restore by creating a branch at a timestamp and switching the connection string.
- **Supabase / AWS RDS / Google Cloud SQL:** enable daily backups plus PITR in the project's database settings.

For an extra copy you control:

```bash
./scripts/backup.sh     # pg_dump → backups/lumera-<timestamp>.dump
```

**Recovery drill** (practise it once):

1. Create an empty database.
2. Run `pg_restore --no-owner --dbname "$NEW_DATABASE_URL" backups/lumera-<timestamp>.dump`.
3. Point `DATABASE_URL` at the new database and restart. Pending migrations apply automatically.
4. Keep the same `BETTER_AUTH_SECRET`. Otherwise sessions and quick-unlock PINs become invalid: people sign in again and reset their PIN.

Owners and admins can also export the core business records at any time from **Settings → Lume & data / Workspace**: everything as JSON, or tasks and profit as CSV. Exports are recorded in the activity history.

---

## Deploying

**Docker:** `docker build -t lumera . && docker run -p 8787:8787 --env-file .env lumera`

**Render:** push the repository and create a *Blueprint* from `render.yaml`. It sets up the web service, PostgreSQL, a generated auth secret and the health check. When asked, enter your own `ADMIN_SIGNUP_CODE` (required). `ANTHROPIC_API_KEY`, `MAIL_FROM` and `RESEND_API_KEY` are optional and can be added later. The app uses its `onrender.com` address automatically; set `APP_URL` only if you add a custom domain.

Production checklist:

- [ ] `DATABASE_URL`, with backups/PITR enabled at the provider
- [ ] `BETTER_AUTH_SECRET` (at least 32 characters, stored in your secret manager)
- [ ] `APP_URL` set to the public `https://` URL. HTTPS enables secure cookies and HSTS. On Render this defaults to the service's own address.
- [ ] `TRUST_PROXY=1` behind a proxy or load balancer, so rate limits see real client IPs
- [ ] An email provider and `MAIL_FROM`. Without one the app still runs, but password-reset and invitation emails can't be sent.
- [ ] `ANTHROPIC_API_KEY`, plus Lume limits suited to your budget
- [ ] Your own four-digit `ADMIN_SIGNUP_CODE`, shared only between the owners. Production won't start without one, because the built-in development code is public.

**Scaling note:** run **one instance**. Live updates (Server-Sent Events) and the app-level rate limiter are in-process. Running more instances would need a shared channel, such as Postgres `LISTEN/NOTIFY`. Auth rate limits are already database-backed.

---

## Security summary

- Better Auth handles sign-up, sign-in, reset and sessions, with database-backed rate limits on every auth endpoint. Wrong admin codes are rate limited separately. The client IP is taken from the socket, or from the proxy when `TRUST_PROXY=1`.
- The server enforces permissions on every API request, and every query is scoped to the caller's workspace.
- Requests are protected against cross-site forgery: writes need the same origin plus a custom header.
- Security headers: a strict Content-Security-Policy, `frame-ancestors 'none'`, and HSTS on HTTPS.
- Each person's writes are rate limited. JSON bodies are capped at 1 MB, and input is validated with shared zod schemas and database constraints.
- Duplicate writes are prevented with idempotency keys on tasks, events, projects, profit entries and Lume actions.
- Shared editing never silently overwrites anyone's work:
  - Tasks and projects detect conflicts field by field and offer *Keep theirs / Use mine*.
  - Events and profit entries use versions and offer *Reload*.
  - Notes use versions and offer *Load their version / Save mine instead*.
- Logs are structured and redact secrets, tokens, passwords, emails and cookies. Request logs omit query strings.
- Secrets exist only in server environment variables. The browser bundle contains no keys.

---

## Testing

```bash
npm run typecheck
npm run build
npm run test:e2e
```

`test:e2e` starts its own server against a throwaway embedded database. It walks through:

- sign-up with instant sign-in, the admin code (including lockout after wrong guesses), and the partner joining the same workspace as an admin
- an invitation accepted through its emailed link
- both owners seeing each other's tasks, events and notes labelled with who added them, note edit conflicts, and live updates
- projects, tasks and events
- a teammate seeing the shared data
- profit totals, including duplicates, negative adjustments and going over target
- a Lume answer and a confirmed Lume action
- persistence after signing out
- permission and cross-workspace isolation checks
- password reset
- DST-safe recurring events and single-occurrence edits
- rejection of invalid input

---

## Project layout

```
server/
  index.ts            app wiring, security headers, static hosting
  env.ts  log.ts      configuration, redacting logger
  auth/               Better Auth config, request context & permissions, PIN
  db/                 schema.ts, migrations/, client (Postgres or PGlite)
  services/           tasks, projects & clients, events (recurrence), notes, profit,
                      workspace & invitations, notifications, reminders, export
  lume/               tools, proposals/confirmation, streaming chat, briefing,
                      prompt, usage limits, development demo responder
  routes/             HTTP endpoints
shared/               types, zod schemas, permissions, dates/time zones,
                      recurrence, money, agency starter templates
src/                  React app (features/*, components, lib, styles)
tests/e2e.ts          end-to-end journey
```

---

## Known limitations and external setup

- **Live Claude responses need your `ANTHROPIC_API_KEY`.** Without a key, only development demo mode was exercised end to end. The live path uses the official SDK (streaming, tool use, adaptive thinking), but it has not been run against the real API from this environment.
- **Email delivery** needs Resend or SMTP credentials. Without them, email works only through the development inbox.
- **Automated backups** must be switched on at your database provider. The app can't enable them for you.
- **Recurring events** support daily, weekly (chosen weekdays) and monthly repeats, with “this event” or “all events” edits. “This and following” edits and per-occurrence attendee changes are not supported. Changing a series' time resets one-off changes to its occurrences, and the editor warns about this.
- Event reminders and due-date notices are **in-app** (bell and toasts). Only task assignments can also be emailed.
- Email addresses aren't confirmed at sign-up. A typo in your email doesn't stop you signing in with it as typed, but reset emails will go to the wrong address, and the email can't be changed in the app yet.
- Changing a sign-in email and deleting an account aren’t available in the app yet. An owner can remove someone from the workspace, which ends their access immediately.
- Run a single server instance (see *Scaling note*).
