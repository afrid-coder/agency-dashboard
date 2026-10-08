// Lumera Creative — front page for the internal workspace.
//
// Direction: "the studio's operating room". An editorial serif statement on
// warm ivory, a live-rendered product trace as the hero's focal asset (real
// interface components with clearly labelled sample content — no stock
// imagery, no illustrated people), and charcoal chapters that explain what
// the workspace controls, what Lume may do, and where access stops.
// Motion: GSAP intro + ScrollTrigger reveals; Lenis is the single smooth-scroll
// engine (chosen over Locomotive Scroll for its native-scroll model and
// small footprint). Reduced motion: no smooth scroll, no scrubbing, final
// states immediately. No Three.js: nothing here needs spatial depth.
import { Fragment, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { gsap, reducedMotion } from '../../lib/motion.ts';
import { Icon, LumeMark, type IconName } from '../../lib/icons.tsx';
import { api } from '../../lib/api.ts';
import { LumeraLogo } from '../../components/LumeraLogo.tsx';
import type { Me } from '../../../shared/types.ts';
import '../../styles/landing.css';

gsap.registerPlugin(ScrollTrigger);

/** Word-split heading: words animate; the unsplit text is what assistive tech reads. */
function SplitHeading({ as: Tag = 'h2', text, className = '', em }: { as?: 'h1' | 'h2'; text: string; className?: string; em?: string }) {
  const words = text.split(' ');
  return (
    <Tag className={`split ${className}`}>
      <span className="sr-only">
        {text}
        {em ? ` ${em}` : ''}
      </span>
      <span aria-hidden="true">
        {words.map((w, i) => (
          <Fragment key={i}>
            <span className="split-word">
              <span className="split-inner">{w}</span>
            </span>{' '}
          </Fragment>
        ))}
        {em && (
          <span className="split-word">
            <em className="split-inner">{em}</em>
          </span>
        )}
      </span>
    </Tag>
  );
}

const ROWS: { icon: IconName; name: string; does: string; who: string; guard: string }[] = [
  {
    icon: 'calendar',
    name: 'Shared calendar',
    does: 'Month, week, day and agenda views of every meeting and deadline, with recurring events and reminders.',
    who: 'Everyone schedules. Private events stay with their attendees.',
    guard: 'Edits never overwrite a teammate’s newer change; recurring edits ask “this event or the series”.',
  },
  {
    icon: 'tasks',
    name: 'Projects & tasks',
    does: 'Client projects move from discovery to launch and ongoing marketing, with starter checklists you can choose to add.',
    who: 'Anyone can create and assign work. Deleting someone else’s task needs an admin.',
    guard: 'Every change saves immediately, shows its save state, and can be undone.',
  },
  {
    icon: 'profit',
    name: 'The $500 monthly goal',
    does: 'Profit entries — not revenue — add up against the month’s target, with history that never resets.',
    who: 'Owners and admins record and edit entries. Members can see progress if you allow it.',
    guard: 'Totals are calculated from saved records. Duplicate submissions are caught.',
  },
  {
    icon: 'chat',
    name: 'Lume, the assistant',
    does: 'A daily briefing, answers about your schedule and deadlines, and drafted task lists for agency work.',
    who: 'Reads only what the person asking may see.',
    guard: 'Proposes changes as previews. Nothing is saved until a person confirms.',
  },
];

const FLOW = [
  { n: '01', title: 'You ask', body: '“Help me plan my day around my meetings.”' },
  { n: '02', title: 'Lume reads permitted records', body: 'Calendar, tasks, projects and the profit goal — scoped to your role.' },
  { n: '03', title: 'It answers or proposes', body: 'Facts are linked to the records they came from. Suggestions are labelled.' },
  { n: '04', title: 'You confirm', body: 'Changes appear as a preview with Confirm, Edit and Cancel.' },
  { n: '05', title: 'Saved and linked', body: 'Only then is the record written — with a link back to it.' },
];

const ACCESS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'mail', title: 'Private by default', body: 'An account alone never grants access to company data. The owners join with a private admin code; everyone else by invitation.' },
  { icon: 'shield', title: 'Roles enforced on the server', body: 'Owner, Admin and Member permissions apply to every request — including Lume’s.' },
  { icon: 'key', title: 'Strong sign-in', body: 'Hashed passwords, rate-limited attempts, a guess-proof admin code and revocable sessions.' },
  { icon: 'lock', title: 'Optional quick unlock', body: 'A four-digit PIN can unlock an idle session on your own device. It can’t sign anyone in.' },
  { icon: 'download', title: 'Your records, exportable', body: 'Admins can export tasks, projects and profit at any time; backups are handled by the database.' },
  { icon: 'history', title: 'A clear history', body: 'Every change is logged, and financial activity is visible only to people who handle it.' },
];

export default function LandingPage() {
  const root = useRef<HTMLDivElement>(null);
  const trace = useRef<HTMLDivElement>(null);
  const me = useQuery({
    queryKey: ['landing-me'],
    queryFn: () => api.get<Me>('/me').catch(() => null),
    retry: false,
    staleTime: 60_000,
  });
  const signedIn = Boolean(me.data);

  useEffect(() => {
    document.title = 'Lumera Creative — Workspace';
  }, []);

  // Motion: intro timeline, scroll reveals, smooth scroll.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (reducedMotion()) {
      el.classList.add('is-static');
      return;
    }
    el.classList.add('is-animated');
    const lenis = new Lenis({ autoRaf: false, lerp: 0.11, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    const ctx = gsap.context(() => {
      const intro = gsap.timeline({ defaults: { ease: 'power3.out' } });
      intro
        .from('.hero .split-inner', { yPercent: 110, duration: 0.9, stagger: 0.06 })
        .from('.hero-eyebrow, .hero-lede, .hero-ctas, .hero-note', { opacity: 0, y: 14, duration: 0.6, stagger: 0.08 }, '-=0.55')
        .from('.trace-card', { opacity: 0, y: 26, duration: 0.8, stagger: 0.12 }, '-=0.7')
        .from('.trace-goal-fill', { scaleX: 0, transformOrigin: 'left center', duration: 1.1, ease: 'power2.inOut' }, '-=0.4');

      gsap.utils.toArray<HTMLElement>('.chapter .split').forEach((h) => {
        gsap.from(h.querySelectorAll('.split-inner'), { yPercent: 110, duration: 0.8, stagger: 0.05, scrollTrigger: { trigger: h, start: 'top 82%' } });
      });
      gsap.utils.toArray<HTMLElement>('[data-reveal-row]').forEach((row, i) => {
        gsap.from(row, { opacity: 0, y: 22, duration: 0.7, delay: (i % 3) * 0.06, scrollTrigger: { trigger: row, start: 'top 88%' } });
      });
      gsap.from('.flow-step', { opacity: 0, x: -16, duration: 0.6, stagger: 0.1, scrollTrigger: { trigger: '.flow', start: 'top 78%' } });
    }, el);

    // Content must never stay hidden behind a stalled animation (paused
    // animation frames, throttled tabs): anything on screen that hasn't
    // finished revealing shortly after it appears is set to its final state.
    const settle = window.setTimeout(() => {
      if (document.hidden) intro_end(el);
    }, 2600);
    const watched = el.querySelectorAll<HTMLElement>('.split, [data-reveal-row], .flow, .trace');
    const timers = new Set<number>();
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const target = entry.target as HTMLElement;
        const t = window.setTimeout(() => {
          const parts = [target, ...target.querySelectorAll<HTMLElement>('.split-inner, .flow-step, .trace-card, .trace-goal-fill')];
          if (parts.some(notSettled)) {
            gsap.killTweensOf(parts);
            gsap.set(parts, { clearProps: 'opacity,transform,visibility' });
          }
        }, 1800);
        timers.add(t);
        io.unobserve(target);
      }
    });
    watched.forEach((w) => io.observe(w));
    void document.fonts?.ready.then(() => ScrollTrigger.refresh());

    return () => {
      window.clearTimeout(settle);
      timers.forEach((t) => window.clearTimeout(t));
      io.disconnect();
      ctx.revert();
      gsap.ticker.remove(tick);
      lenis.destroy();
      el.classList.remove('is-animated');
    };
  }, []);

  // Additive pointer depth on the product trace (fine pointers only).
  useEffect(() => {
    const el = trace.current;
    if (!el || reducedMotion() || !window.matchMedia('(pointer: fine)').matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--rx', `${(-y * 4).toFixed(2)}deg`);
        el.style.setProperty('--ry', `${(x * 5).toFixed(2)}deg`);
      });
    };
    const reset = () => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', reset);
    window.addEventListener('blur', reset);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', reset);
      window.removeEventListener('blur', reset);
    };
  }, []);

  return (
    <div className="landing" ref={root}>
      <a href="#landing-main" className="skip-link">
        Skip to content
      </a>
      <header className="l-nav">
        <Link to="/" className="l-logo" aria-label="Lumera Creative home">
          <LumeraLogo size={34} /> <span>Lumera Creative</span>
        </Link>
        <nav className="l-nav-links" aria-label="Page sections">
          <a href="#workspace">Workspace</a>
          <a href="#lume">Lume</a>
          <a href="#access">Access</a>
        </nav>
        <div className="l-nav-cta">
          {signedIn ? (
            <Link to="/app" className="btn btn-primary btn-md">
              Open workspace <Icon name="arrowRight" size={16} />
            </Link>
          ) : (
            <>
              <Link to="/signin" className="btn btn-ghost btn-md l-signin">
                Sign in
              </Link>
              <Link to="/signup" className="btn btn-primary btn-md">
                Create account
              </Link>
            </>
          )}
        </div>
      </header>

      <main id="landing-main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="hero-eyebrow mono-label">Lumera Creative · Internal workspace</p>
            <h1 id="hero-title" className="hero-title split">
              <span className="sr-only">Run the studio from one calm place.</span>
              <span aria-hidden="true">
                {['Run', 'the', 'studio', 'from'].map((w) => (
                  <Fragment key={w}>
                    <span className="split-word">
                      <span className="split-inner">{w}</span>
                    </span>{' '}
                  </Fragment>
                ))}
                <br />
                <span className="split-word">
                  <span className="split-inner">one</span>
                </span>{' '}
                <span className="split-word">
                  <em className="split-inner">calm place.</em>
                </span>
              </span>
            </h1>
            <p className="hero-lede">
              The shared calendar, client projects, the $500 monthly profit goal and Lume — our AI assistant — in one workspace built for how a web and marketing studio actually runs.
            </p>
            <div className="hero-ctas">
              {signedIn ? (
                <Link to="/app" className="btn btn-primary btn-lg">
                  Open the workspace <Icon name="arrowRight" size={17} />
                </Link>
              ) : (
                <>
                  <Link to="/signup" className="btn btn-primary btn-lg">
                    Create account
                  </Link>
                  <Link to="/signin" className="btn btn-secondary btn-lg">
                    Sign in
                  </Link>
                </>
              )}
            </div>
            <p className="hero-note">
              <Icon name="shield" size={15} /> Company data is visible only to the owners and the people they invite.
            </p>
          </div>

          <div className="trace" ref={trace} aria-label="Preview of the workspace with sample content" role="img">
            <div className="trace-stage">
              <div className="trace-card trace-brief">
                <p className="trace-label">
                  <LumeMark size={14} /> Your day with Lume
                </p>
                <p className="trace-summary">Two meetings, three tasks due and one overdue. Profit is at $320 of the $500 goal.</p>
                <ol className="trace-priorities">
                  <li>Send homepage wireframes for review</li>
                  <li>Prepare the launch checklist</li>
                  <li>Clear the overdue analytics audit</li>
                </ol>
                <p className="trace-sample">Sample content</p>
              </div>
              <div className="trace-card trace-cal">
                <p className="trace-label">
                  <Icon name="calendar" size={14} /> Thursday
                </p>
                <ul className="trace-events">
                  <li className="is-event">
                    <span>9:30</span> Studio sync
                  </li>
                  <li className="is-event is-accent">
                    <span>2:00</span> Client design review
                  </li>
                  <li className="is-task">
                    <span>Due</span> Launch QA pass
                  </li>
                </ul>
              </div>
              <div className="trace-card trace-goal">
                <p className="trace-label">
                  <Icon name="profit" size={14} /> Monthly profit goal
                </p>
                <p className="trace-amount">
                  $320 <span>of $500</span>
                </p>
                <div className="trace-goal-bar">
                  <span className="trace-goal-fill" />
                </div>
                <p className="trace-goal-meta">64% · $180 to go</p>
              </div>
              <div className="trace-card trace-confirm">
                <p className="trace-label">
                  <Icon name="edit" size={14} /> Proposed by Lume
                </p>
                <p className="trace-confirm-title">New task · Send proposal to client</p>
                <div className="trace-buttons">
                  <span className="trace-btn is-primary">Confirm</span>
                  <span className="trace-btn">Edit</span>
                  <span className="trace-btn">Cancel</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="chapter chapter-dark" id="workspace" aria-labelledby="ws-title">
          <div className="chapter-inner">
            <p className="mono-label">What the workspace holds</p>
            <SplitHeading text="Four tools, one source of" em="truth." className="chapter-title" />
            <p className="chapter-lede">Each part does one job well and knows who is allowed to change what.</p>
            <div className="rows" role="list">
              <div className="row row-head" aria-hidden="true">
                <span />
                <span>What it does</span>
                <span>Who can act</span>
                <span>What protects it</span>
              </div>
              {ROWS.map((r) => (
                <div className="row" role="listitem" key={r.name} data-reveal-row>
                  <h3 className="row-name">
                    <Icon name={r.icon} size={20} /> {r.name}
                  </h3>
                  <p>
                    <span className="row-k">What it does</span>
                    {r.does}
                  </p>
                  <p>
                    <span className="row-k">Who can act</span>
                    {r.who}
                  </p>
                  <p>
                    <span className="row-k">What protects it</span>
                    {r.guard}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="chapter chapter-light" id="lume" aria-labelledby="lume-title">
          <div className="chapter-inner lume-chapter">
            <div>
              <p className="mono-label">
                <LumeMark size={14} /> Lume
              </p>
              <SplitHeading text="An assistant that asks before it" em="acts." className="chapter-title" />
              <p className="chapter-lede">
                Lume is Lumera Creative’s AI assistant, powered by Anthropic’s Claude models. It works from the records you’re allowed to see, links every fact to its source, labels suggestions as suggestions, and never reports a change as done until it has been saved.
              </p>
              <p className="fine-print">Relevant records are sent to Anthropic only to answer a request you make.</p>
            </div>
            <ol className="flow">
              {FLOW.map((s) => (
                <li key={s.n} className="flow-step">
                  <span className="flow-n">{s.n}</span>
                  <div>
                    <p className="flow-title">{s.title}</p>
                    <p className="flow-body">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="chapter chapter-dark" id="access" aria-labelledby="access-title">
          <div className="chapter-inner">
            <p className="mono-label">Access & security</p>
            <SplitHeading text="Company data stays with the" em="company." className="chapter-title" />
            <div className="access-grid">
              {ACCESS.map((a) => (
                <div key={a.title} className="access-item" data-reveal-row>
                  <Icon name={a.icon} size={22} />
                  <h3>{a.title}</h3>
                  <p>{a.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="chapter chapter-light final" aria-labelledby="final-title">
          <div className="chapter-inner final-inner">
            <SplitHeading text="Join your" em="team." className="chapter-title" />
            <ol className="final-steps">
              <li data-reveal-row>
                <span className="flow-n">1</span> Create an account with your name, email and a password — you’re signed in straight away.
              </li>
              <li data-reveal-row>
                <span className="flow-n">2</span> Business owner? Switch on Admin and enter the admin code.
              </li>
              <li data-reveal-row>
                <span className="flow-n">3</span> Team member? Open the invitation an owner or admin sends to your email — then you’re in.
              </li>
            </ol>
            <div className="hero-ctas">
              {signedIn ? (
                <Link to="/app" className="btn btn-primary btn-lg">
                  Open the workspace
                </Link>
              ) : (
                <>
                  <Link to="/signup" className="btn btn-primary btn-lg">
                    Create account
                  </Link>
                  <Link to="/signin" className="btn btn-secondary btn-lg">
                    I have an account
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="l-foot">
        <span className="l-logo">
          <LumeraLogo size={26} /> Lumera Creative
        </span>
        <p>Internal workspace for the Lumera Creative team. Icons: Solar by 480 Design (CC BY 4.0).</p>
      </footer>
    </div>
  );
}

/** Still transparent, or still offset from its resting position. */
function notSettled(el: HTMLElement) {
  const cs = getComputedStyle(el);
  if (Number(cs.opacity) < 0.99) return true;
  const m = /matrix\(([^)]+)\)/.exec(cs.transform);
  if (!m) return false;
  const [, , , , tx, ty] = m[1].split(',').map((v) => Math.abs(Number(v)));
  return tx > 0.5 || ty > 0.5;
}

function intro_end(el: HTMLElement) {
  gsap.set(el.querySelectorAll('.split-inner, .hero-eyebrow, .hero-lede, .hero-ctas, .hero-note, .trace-card, .trace-goal-fill, [data-reveal-row], .flow-step'), { clearProps: 'all' });
}
