// In-process fan-out for Server-Sent Events. Mutations publish a small
// "what changed" message per workspace; clients refetch just those queries.
// Notifications are addressed to specific people.
//
// Multiple server instances would need a shared channel (for example
// Postgres LISTEN/NOTIFY); see README → Scaling.

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
