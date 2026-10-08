// Change announcements. Mutations publish a small "what changed" message per
// workspace; clients refetch just those queries. Notifications are addressed
// to specific people.
//
// Node: in-process fan-out over Server-Sent Events (one instance; see
// README → Scaling). Supabase: Realtime broadcast, because each request may
// run in a different short-lived instance. Broadcasts carry only topics and
// the actor's id — never record content — and channels are named by the
// unguessable workspace or user id.
import { realtimeBroadcast } from './env.ts';
import { log } from './log.ts';
import { waitUntil } from './runtime.ts';

export type Topic = 'tasks' | 'events' | 'projects' | 'clients' | 'profit' | 'members' | 'workspace' | 'activity' | 'notifications' | 'briefing' | 'notes';

export interface ChangeMessage {
  topics: Topic[];
  actorId: string | null;
  /** Only these people receive the message (for personal notifications). */
  userIds?: string[];
  notification?: { title: string; body: string; link: string | null; kind: string };
}

type Listener = { userId: string; send: (m: ChangeMessage) => void };
const listeners = new Map<string, Set<Listener>>();

export function subscribe(orgId: string, listener: Listener): () => void {
  let set = listeners.get(orgId);
  if (!set) listeners.set(orgId, (set = new Set()));
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(orgId);
  };
}

export function publish(orgId: string, message: ChangeMessage) {
  if (realtimeBroadcast) {
    const payload = { topics: message.topics, actorId: message.actorId };
    if (message.userIds) for (const id of message.userIds) broadcast(`lumera:user:${id}`, payload);
    else broadcast(`lumera:org:${orgId}`, payload);
  }
  for (const l of listeners.get(orgId) ?? []) {
    if (message.userIds && !message.userIds.includes(l.userId)) continue;
    try {
      l.send(message);
    } catch {
      /* a broken stream must not affect other listeners */
    }
  }
}

/** Disconnect a person's live streams (after removal from a workspace). */
export function connectionCount() {
  let n = 0;
  for (const s of listeners.values()) n += s.size;
  return n;
}

let broadcastWarned = false;
function broadcast(topic: string, payload: { topics: Topic[]; actorId: string | null }) {
  const { url, key } = realtimeBroadcast!;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: key };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // legacy JWT keys
  const send = fetch(`${url}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages: [{ topic, event: 'change', payload }] }),
  })
    .then(async (res) => {
      if (!res.ok && !broadcastWarned) {
        broadcastWarned = true;
        log.warn('realtime.broadcast_failed', { status: res.status, body: (await res.text()).slice(0, 200) });
      }
    })
    .catch((err) => log.warn('realtime.broadcast_error', { message: String(err).slice(0, 200) }));
  // Let the response go out now; finish the broadcast in the background.
  waitUntil(send);
}
