// Lume, Lumera Creative's AI assistant: a right-side panel on desktop and a
// full-screen sheet on mobile, available from every page.
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button, IconButton, Notice, Spinner } from '../../components/ui.tsx';
import { ConfirmDialog } from '../../components/extras.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Icon, LumeMark } from '../../lib/icons.tsx';
import { api, apiUrl, authHeaders, CLIENT_HEADERS, CROSS_ORIGIN_API, errorMessage } from '../../lib/api.ts';
import { invalidateEvents, invalidateWork, keys, useLumeConversation, useLumeConversations } from '../../lib/queries.ts';
import { panelIn, panelOut } from '../../lib/motion.ts';
import { relativeTime } from '../../lib/format.ts';
import { storage } from '../../lib/theme.ts';
import { useUI } from '../shell/ui.tsx';
import { tzOf, useMeData } from '../shell/me.tsx';
import { LumeText } from './LumeText.tsx';
import { ActionCard } from './ActionCard.tsx';
import { LUME_MAX_INPUT_CHARS } from '../../../shared/schemas.ts';
import { formatInstant } from '../../../shared/dates.ts';
import type { LumeAction, LumeMessage, LumeStreamEvent, RecordRef } from '../../../shared/types.ts';

type Page = 'dashboard' | 'calendar' | 'tasks' | 'projects' | 'project' | 'clients' | 'profit' | 'settings' | 'other';

const pageOf = (path: string): Page => {
  if (path === '/app' || path === '/app/') return 'dashboard';
  if (path.startsWith('/app/projects/')) return 'project';
  const seg = path.split('/')[2] as Page | undefined;
  return seg && ['calendar', 'tasks', 'projects', 'clients', 'profit', 'settings'].includes(seg) ? seg : 'other';
};

const STARTERS: Record<Page, string[]> = {
  dashboard: ['What should I focus on today?', 'Help me plan my day around my meetings.', 'Which tasks are overdue?', 'How close are we to our monthly profit goal?'],
  calendar: ['What does the team have scheduled tomorrow?', 'Help me plan my day around my meetings.', 'What deadlines do we have this week?', 'Schedule a 30-minute team check-in tomorrow at 10am.'],
  tasks: ['Which tasks are overdue?', 'What deadlines do we have this week?', 'What should I focus on today?', 'Which of my tasks can wait until next week?'],
  projects: ['Which projects need attention this week?', 'Draft a launch task list for our next launch.', 'Summarise where each active project stands.', 'What deadlines do we have this week?'],
  project: ['What are the practical next steps for this project?', 'Draft a client review task list for this project.', 'What’s overdue on this project?', 'Schedule a kickoff call for this project.'],
  clients: ['Which clients have active projects?', 'Which client work is due this week?', 'What should I prepare for upcoming client meetings?', 'How close are we to our monthly profit goal?'],
  profit: ['How close are we to our monthly profit goal?', 'How does this month compare with the last two?', 'Which projects could bring in profit this month?', 'What’s left to reach the target?'],
  settings: ['What can you help me with?', 'What should I focus on today?', 'Which tasks are overdue?', 'Help me prepare a weekly agenda.'],
  other: ['What should I focus on today?', 'Help me prepare a weekly agenda.', 'Which tasks are overdue?', 'How close are we to our monthly profit goal?'],
};

const lastConv = storage<Record<string, string>>('lumera.lume.last', {});

interface Streaming {
  id: string;
  text: string;
  status: string | null;
  refs: RecordRef[];
  actionIds: string[];
}

export function LumePanel() {
  const ui = useUI();
  const me = useMeData();
  const qc = useQueryClient();
  const toast = useToast();
  const location = useLocation();
  const page = pageOf(location.pathname);
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const memoryKey = `${me.user.id}:${me.workspace!.id}`;

  const [conversationId, setConversationId] = useState<string | null>(() => lastConv.get()[memoryKey] ?? null);
  const [view, setView] = useState<'chat' | 'history' | 'about'>('chat');
  const [messages, setMessages] = useState<LumeMessage[]>([]);
  const [actions, setActions] = useState<Record<string, LumeAction>>({});
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<{ message: string; retryOf?: string; retryable: boolean } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [clearAll, setClearAll] = useState(false);
  const conv = useLumeConversation(ui.lume.open ? conversationId : null);
  const history = useLumeConversations(ui.lume.open && view === 'history');
  const mode = me.lume.mode;

  // Load a stored conversation.
  useEffect(() => {
    if (conv.data) {
      setMessages(conv.data.messages);
      setActions(Object.fromEntries(conv.data.actions.map((a) => [a.id, a])));
    }
  }, [conv.data]);
  useEffect(() => {
    if (conv.isError) {
      setConversationId(null);
      setMessages([]);
    }
  }, [conv.isError]);
  useEffect(() => {
    const all = lastConv.get();
    if (conversationId) all[memoryKey] = conversationId;
    else delete all[memoryKey];
    lastConv.set(all);
  }, [conversationId, memoryKey]);

  // Open / close with motion, focus management and Escape.
  useEffect(() => {
    if (ui.lume.open) {
      opener.current = document.activeElement as HTMLElement | null;
      setMounted(true);
    } else if (mounted && panel.current) {
      void panelOut(panel.current, window.matchMedia('(max-width: 1023px)').matches ? 'bottom' : 'right').then(() => {
        setMounted(false);
        opener.current?.focus?.();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.lume.open]);
  useEffect(() => {
    if (!mounted || !ui.lume.open || !panel.current) return;
    panelIn(panel.current, window.matchMedia('(max-width: 1023px)').matches ? 'bottom' : 'right');
    window.setTimeout(() => input.current?.focus(), 30);
  }, [mounted, ui.lume.open]);
  useEffect(() => {
    if (!ui.lume.open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) ui.closeLume();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui.lume.open, ui]);

  // Keep the newest content in view.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming?.text, streaming?.status, streaming?.actionIds.length]);

  const send = useCallback(
    async (text: string, retryOf?: string) => {
      const message = text.trim();
      if ((!message && !retryOf) || streaming) return;
      setError(null);
      setView('chat');
      const controller = new AbortController();
      abort.current = controller;
      if (!retryOf) {
        setMessages((m) => [...m, { id: `local-${Date.now()}`, role: 'user', text: message, demo: false, createdAt: new Date().toISOString(), refs: [], sources: [], retrievedAt: null, actionIds: [], error: null }]);
        setDraft('');
      } else setMessages((m) => m.filter((x) => x.id !== retryOf));
      setStreaming({ id: 'pending', text: '', status: 'Thinking', refs: [], actionIds: [] });
      try {
        const res = await fetch(apiUrl('/api/lume/chat'), {
          method: 'POST',
          credentials: CROSS_ORIGIN_API ? 'omit' : 'same-origin',
          headers: { 'Content-Type': 'application/json', ...CLIENT_HEADERS, ...authHeaders() },
          body: JSON.stringify({ conversationId, message: message || 'retry', page, timezone: tzOf(me), retryOf }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? `Lume couldn’t start (${res.status}).`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const line = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            handle(JSON.parse(line.slice(6)) as LumeStreamEvent);
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          setError({ message: 'Stopped. Ask again whenever you’re ready.', retryable: false });
        } else setError({ message: errorMessage(err), retryable: true });
        setStreaming(null);
      } finally {
        abort.current = null;
      }

      function handle(e: LumeStreamEvent) {
        switch (e.type) {
          case 'start':
            setConversationId(e.conversationId);
            setMessages((m) => m.map((x) => (x.id.startsWith('local-') ? { ...x, id: e.userMessageId } : x)));
            setStreaming((s) => (s ? { ...s, id: e.messageId } : s));
            break;
          case 'status':
            setStreaming((s) => (s ? { ...s, status: e.label } : s));
            break;
          case 'delta':
            setStreaming((s) => (s ? { ...s, text: s.text + e.text, status: null } : s));
            break;
          case 'refs':
            setStreaming((s) => (s ? { ...s, refs: e.refs } : s));
            break;
          case 'action':
            setActions((a) => ({ ...a, [e.action.id]: e.action }));
            setStreaming((s) => (s ? { ...s, actionIds: [...s.actionIds, e.action.id] } : s));
            break;
          case 'error':
            setError({ message: e.message, retryable: e.retryable });
            break;
          case 'done':
            setMessages((m) => [...m, e.message]);
            setStreaming(null);
            if (e.message.error) setError({ message: e.message.error.message, retryOf: e.message.id, retryable: e.message.error.retryable });
            void qc.invalidateQueries({ queryKey: keys.lumeConversations });
            break;
        }
      }
    },
    [conversationId, me, page, qc, streaming],
  );

  // Prompts sent from elsewhere (e.g. "Next steps" on a project page).
  useEffect(() => {
    if (ui.lume.open && ui.lume.prompt && mode !== 'unconfigured') {
      const p = ui.lume.prompt;
      ui.consumeLumePrompt();
      void send(p);
    }
  }, [ui.lume.open, ui.lume.prompt, send, ui, mode]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  };

  const newConversation = () => {
    abort.current?.abort();
    setConversationId(null);
    setMessages([]);
    setActions({});
    setError(null);
    setView('chat');
    window.setTimeout(() => input.current?.focus(), 0);
  };

  const onActionChange = (a: LumeAction) => {
    setActions((all) => ({ ...all, [a.id]: a }));
    if (a.status === 'confirmed') {
      invalidateWork(qc);
      invalidateEvents(qc);
      if (conversationId) void qc.invalidateQueries({ queryKey: keys.lumeConversation(conversationId) });
      toast({ tone: 'success', message: a.result?.message ?? 'Saved' });
    }
  };

  if (!mounted) return null;
  const busy = streaming !== null;
  const empty = messages.length === 0 && !streaming;

  return (
    <aside ref={panel} className="lume" role="dialog" aria-modal="false" aria-labelledby="lume-name" aria-describedby="lume-sub">
      <header className="lume-head">
        <span className="lume-avatar">
          <LumeMark size={22} active={busy} />
        </span>
        <div className="lume-id">
          <h2 id="lume-name" className="lume-name">
            Lume
            {mode === 'demo' && <span className="tag tag-violet tag-xs">Demo mode</span>}
          </h2>
          <p id="lume-sub" className="lume-sub">
            Lumera Creative’s AI assistant
          </p>
        </div>
        <div className="lume-head-actions">
          <IconButton icon="history" label="Conversation history" onClick={() => setView(view === 'history' ? 'chat' : 'history')} aria-pressed={view === 'history'} />
          <IconButton icon="plus" label="New conversation" onClick={newConversation} />
          <IconButton icon="info" label="About Lume and your data" onClick={() => setView(view === 'about' ? 'chat' : 'about')} aria-pressed={view === 'about'} />
          <IconButton icon="x" label="Close Lume" onClick={ui.closeLume} />
        </div>
      </header>

      {view === 'history' && (
        <div className="lume-side">
          <h3 className="lume-side-title">Conversations</h3>
          {history.isPending && <Spinner />}
          {history.data?.length === 0 && <p className="muted-sm">No saved conversations yet.</p>}
          <ul className="lume-history">
            {history.data?.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`lume-history-item ${c.id === conversationId ? 'is-current' : ''}`}
                  onClick={() => {
                    setConversationId(c.id);
                    setError(null);
                    setView('chat');
                  }}
                >
                  <span className="truncate">{c.title}</span>
                  <span className="muted-sm">{relativeTime(c.updatedAt)}</span>
                </button>
                <IconButton
                  icon="trash"
                  size="sm"
                  label={`Delete “${c.title}”`}
                  onClick={async () => {
                    try {
                      await api.del(`/lume/conversations/${c.id}`);
                      if (c.id === conversationId) newConversation();
                      void qc.invalidateQueries({ queryKey: keys.lumeConversations });
                    } catch (err) {
                      toast({ tone: 'error', message: errorMessage(err) });
                    }
                  }}
                />
              </li>
            ))}
          </ul>
          {Boolean(history.data?.length) && (
            <Button variant="danger" size="sm" icon="trash" onClick={() => setClearAll(true)}>
              Delete all conversations
            </Button>
          )}
        </div>
      )}

      {view === 'about' && (
        <div className="lume-side lume-about">
          <h3 className="lume-side-title">About Lume</h3>
          <p>Lume helps with priorities, schedules, tasks and progress toward the monthly profit goal, using the records you’re allowed to see in this workspace.</p>
          <ul className="about-list">
            <li>
              <Icon name="shield" size={16} /> Lume can only read what your role permits, and never saves a change until you confirm it.
            </li>
            <li>
              <Icon name="database" size={16} /> To answer, the workspace records relevant to your request are sent to Anthropic, the AI provider, for processing.
            </li>
            <li>
              <Icon name="history" size={16} /> Conversations are saved to your account only. Delete them any time from the history view or Settings.
            </li>
            <li>
              <Icon name="profit" size={16} /> Money figures come from the app’s own calculations of recorded profit — never estimates presented as fact.
            </li>
          </ul>
          {mode === 'demo' && (
            <Notice tone="violet">
              Demo mode: no Claude API key is configured on this development server, so answers are scripted responses built from your real records. They are labelled “Demo response”.
            </Notice>
          )}
          <p className="powered">{mode === 'live' ? `Powered by Claude${me.lume.model ? ` · ${me.lume.model}` : ''}` : 'Powered by Claude when connected'}</p>
        </div>
      )}

      {view === 'chat' && (
        <>
          <div className="lume-scroll" ref={scroller} aria-live="polite" aria-busy={busy}>
            {mode === 'unconfigured' ? (
              <div className="lume-empty">
                <LumeMark size={36} />
                <p className="lume-empty-title">Lume isn’t connected yet</p>
                <p className="muted-sm">An owner needs to add an Anthropic API key (ANTHROPIC_API_KEY) on the server. Until then, your briefing facts and every other part of the workspace still work.</p>
              </div>
            ) : empty ? (
              <div className="lume-empty">
                <LumeMark size={36} />
                <p className="lume-empty-title">How can I help, {me.user.name.split(' ')[0]}?</p>
                <p className="muted-sm">I look things up in your calendar, tasks, projects and profit goal, and I ask before changing anything.</p>
                <div className="lume-starters">
                  {STARTERS[page].map((s) => (
                    <button key={s} type="button" className="lume-starter" onClick={() => void send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ol className="lume-thread">
                {conv.isPending && conversationId && messages.length === 0 && (
                  <li className="lume-loading">
                    <Spinner /> Loading conversation…
                  </li>
                )}
                {messages.map((m) => (
                  <MessageItem key={m.id} m={m} actions={actions} tz={tzOf(me)} onActionChange={onActionChange} />
                ))}
                {streaming && (
                  <li className="lume-msg is-assistant is-streaming">
                    {streaming.text ? <LumeText text={streaming.text} refs={streaming.refs} /> : null}
                    {streaming.status && (
                      <p className="lume-status">
                        <LumeMark size={14} active /> {streaming.status}…
                      </p>
                    )}
                    {streaming.actionIds.map((id) => actions[id] && <ActionCard key={id} action={actions[id]} onChange={onActionChange} />)}
                  </li>
                )}
              </ol>
            )}
            {error && (
              <Notice
                tone={error.retryable ? 'danger' : 'info'}
                action={
                  error.retryable && error.retryOf ? (
                    <Button size="sm" variant="secondary" icon="refresh" onClick={() => void send('', error.retryOf)}>
                      Retry
                    </Button>
                  ) : undefined
                }
              >
                {error.message}
              </Notice>
            )}
          </div>

          <form className="lume-composer" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor="lume-input">
              Message Lume
            </label>
            <textarea
              id="lume-input"
              ref={input}
              className="lume-input"
              rows={1}
              value={draft}
              maxLength={LUME_MAX_INPUT_CHARS}
              placeholder={mode === 'unconfigured' ? 'Lume isn’t connected' : 'Message Lume…'}
              disabled={mode === 'unconfigured'}
              onChange={(e) => {
                setDraft(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={onKey}
            />
            {busy ? (
              <IconButton icon="stop" label="Stop generating" variant="secondary" onClick={() => abort.current?.abort()} />
            ) : (
              <button type="submit" className="lume-send" aria-label="Send" disabled={!draft.trim() || mode === 'unconfigured'}>
                <Icon name="send" size={18} />
              </button>
            )}
            <p className="lume-disclosure">
              {draft.length > LUME_MAX_INPUT_CHARS - 400 ? `${LUME_MAX_INPUT_CHARS - draft.length} characters left · ` : ''}Relevant workspace records are sent to Anthropic to answer. Lume asks before saving changes.
            </p>
          </form>
        </>
      )}
      <ConfirmDialog
        open={clearAll}
        title="Delete all conversations?"
        confirmLabel="Delete all"
        onClose={() => setClearAll(false)}
        onConfirm={async () => {
          try {
            await api.del('/lume/conversations');
            newConversation();
            void qc.invalidateQueries({ queryKey: keys.lumeConversations });
          } catch (err) {
            toast({ tone: 'error', message: errorMessage(err) });
          }
          setClearAll(false);
        }}
      >
        Every Lume conversation and saved briefing for your account in this workspace will be permanently deleted. Records Lume helped create are not affected.
      </ConfirmDialog>
    </aside>
  );
}

function MessageItem({ m, actions, tz, onActionChange }: { m: LumeMessage; actions: Record<string, LumeAction>; tz: string; onActionChange: (a: LumeAction) => void }) {
  if (m.role === 'user')
    return (
      <li className="lume-msg is-user">
        <p>{m.text}</p>
      </li>
    );
  return (
    <li className={`lume-msg is-assistant ${m.error ? 'has-error' : ''}`}>
      {m.text && <LumeText text={m.text} refs={m.refs} />}
      {m.actionIds.map((id) => actions[id] && <ActionCard key={id} action={actions[id]} onChange={onActionChange} />)}
      {(m.sources.length > 0 || m.demo) && (
        <p className="lume-meta">
          {m.demo && <span className="tag tag-xs">Demo response</span>}
          {m.sources.length > 0 && (
            <span>
              From {m.sources.join(', ')}
              {m.retrievedAt && ` · retrieved ${formatInstant(m.retrievedAt, tz, { hour: 'numeric', minute: '2-digit' })}`}
            </span>
          )}
        </p>
      )}
    </li>
  );
}
