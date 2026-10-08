import { useEffect, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, apiUrl } from './api.ts';
import { invalidateEvents, invalidateProfit, invalidateWork, keys } from './queries.ts';
import type { NotificationItem, Page } from '../../shared/types.ts';

type Topic = 'tasks' | 'events' | 'projects' | 'clients' | 'profit' | 'members' | 'workspace' | 'activity' | 'notifications' | 'briefing' | 'notes';
export type LiveState = 'connecting' | 'live' | 'reconnecting';
export interface LiveNotification {
  title: string;
  body: string;
  link: string | null;
  kind: string;
}
interface Change {
  topics: Topic[];
  notification?: LiveNotification | null;
}

// Set at build time for the GitHub Pages build; empty in development.
const SUPABASE_URL = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '').replace(/\/$/, '');
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY as string | undefined) ?? '';

/**
 * Subscribes to workspace changes. Each message names what changed; only
 * those queries refetch, so teammates' edits appear without a reload. While
 * disconnected it falls back to periodic refetching.
 *
 * - Same-origin server: Server-Sent Events from /api/stream.
 * - API on Supabase: Realtime broadcast channels for the workspace and for
 *   the person's own notifications.
 */
export function useLiveUpdates(scope: { orgId: string; userId: string }, onNotification: (n: LiveNotification) => void): LiveState {
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>('connecting');

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: number | undefined;
    let fallback: number | undefined;

    const refreshAll = () => {
      invalidateWork(qc);
      invalidateEvents(qc);
      invalidateProfit(qc);
      void qc.invalidateQueries({ queryKey: keys.notifications });
      void qc.invalidateQueries({ queryKey: keys.notes });
    };
    const connected = () => {
      if (retry > 0) refreshAll();
      retry = 0;
      setState('live');
      window.clearInterval(fallback);
    };
    const lost = (reconnect: () => void) => {
      if (closed) return;
      setState('reconnecting');
      window.clearInterval(fallback);
      fallback = window.setInterval(refreshAll, 30_000);
      retry += 1;
      timer = window.setTimeout(reconnect, Math.min(1000 * 2 ** retry, 30_000));
    };
    const onChange = (change: Change) => {
      applyChange(qc, change.topics);
      if (change.notification) onNotification(change.notification);
      // Realtime messages carry no content: fetch the newest notification to announce it.
      else if (SUPABASE_URL && change.topics.includes('notifications')) void announceLatest(onNotification);
    };

    let stop: () => void;
    if (SUPABASE_URL && SUPABASE_KEY) {
      stop = realtime([`lumera:org:${scope.orgId}`, `lumera:user:${scope.userId}`], { connected, lost, onChange });
    } else {
      let source: EventSource | null = null;
      const connect = () => {
        source = new EventSource(apiUrl('/api/stream'));
        source.addEventListener('ready', connected);
        source.addEventListener('change', (e) => onChange(JSON.parse((e as MessageEvent).data) as Change));
        source.onerror = () => {
          source?.close();
          lost(connect);
        };
      };
      connect();
      stop = () => source?.close();
    }
    return () => {
      closed = true;
      stop();
      window.clearTimeout(timer);
      window.clearInterval(fallback);
    };
    // onNotification is intentionally excluded: it is stable per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.orgId, scope.userId, qc]);

  return state;
}

function applyChange(qc: QueryClient, topics: Topic[]) {
  const t = new Set(topics);
  if (t.has('tasks') || t.has('projects')) invalidateWork(qc);
  if (t.has('events')) invalidateEvents(qc);
  if (t.has('profit')) invalidateProfit(qc);
  if (t.has('clients')) void qc.invalidateQueries({ queryKey: keys.clients });
  if (t.has('members')) {
    void qc.invalidateQueries({ queryKey: keys.members });
    void qc.invalidateQueries({ queryKey: keys.invitations });
  }
  if (t.has('workspace')) void qc.invalidateQueries({ queryKey: keys.me });
  if (t.has('activity')) void qc.invalidateQueries({ queryKey: keys.activity });
  if (t.has('notes')) void qc.invalidateQueries({ queryKey: keys.notes });
  if (t.has('notifications')) void qc.invalidateQueries({ queryKey: keys.notifications });
}

const announced = new Set<string>();
async function announceLatest(onNotification: (n: LiveNotification) => void) {
  try {
    const page = await api.get<Page<NotificationItem>>('/notifications');
    const n = page.items[0];
    if (!n || n.read || announced.has(n.id) || Date.now() - new Date(n.createdAt).getTime() > 120_000) return;
    announced.add(n.id);
    onNotification({ title: n.title, body: n.body, link: n.link, kind: n.kind });
  } catch {
    /* the bell still updates */
  }
}

/**
 * Minimal Supabase Realtime client (Phoenix channels over a WebSocket) for
 * public broadcast channels: join, heartbeat, receive "change" broadcasts.
 */
function realtime(channels: string[], on: { connected: () => void; lost: (reconnect: () => void) => void; onChange: (c: Change) => void }): () => void {
  let ws: WebSocket | null = null;
  let heartbeat: number | undefined;
  let ref = 0;
  let stopped = false;

  const send = (topic: string, event: string, payload: unknown, joinRef?: string) => {
    const r = String(++ref);
    ws?.send(JSON.stringify({ topic, event, payload, ref: r, join_ref: joinRef ?? null }));
    return r;
  };

  const connect = () => {
    const url = `${SUPABASE_URL.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(SUPABASE_KEY)}&vsn=1.0.0`;
    ws = new WebSocket(url);
    const pending = new Set<string>();
    ws.onopen = () => {
      for (const name of channels) {
        const topic = `realtime:${name}`;
        const joinRef = String(ref + 1);
        pending.add(send(topic, 'phx_join', { config: { broadcast: { ack: false, self: false }, presence: { key: '' }, postgres_changes: [], private: false } }, joinRef));
      }
      heartbeat = window.setInterval(() => send('phoenix', 'heartbeat', {}), 25_000);
    };
    ws.onmessage = (e) => {
      let msg: { event?: string; ref?: string | null; payload?: { status?: string; event?: string; payload?: Change } };
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.event === 'phx_reply' && msg.ref && pending.has(msg.ref)) {
        if (msg.payload?.status !== 'ok') return ws?.close();
        pending.delete(msg.ref);
        if (pending.size === 0) on.connected();
      } else if (msg.event === 'broadcast' && msg.payload?.event === 'change' && msg.payload.payload) {
        on.onChange(msg.payload.payload);
      } else if (msg.event === 'phx_error' || msg.event === 'phx_close') {
        ws?.close();
      }
    };
    ws.onclose = () => {
      window.clearInterval(heartbeat);
      if (!stopped) on.lost(connect);
    };
  };
  connect();
  return () => {
    stopped = true;
    window.clearInterval(heartbeat);
    ws?.close();
  };
}
