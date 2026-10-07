import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateEvents, invalidateProfit, invalidateWork, keys } from './queries.ts';

type Topic = 'tasks' | 'events' | 'projects' | 'clients' | 'profit' | 'members' | 'workspace' | 'activity' | 'notifications' | 'briefing' | 'notes';
export type LiveState = 'connecting' | 'live' | 'reconnecting';
export interface LiveNotification {
  title: string;
  body: string;
  link: string | null;
  kind: string;
}

/**
 * Subscribes to workspace changes over Server-Sent Events. Each message names
 * what changed; only those queries refetch, so teammates' edits appear
 * without a reload. While disconnected it falls back to periodic refetching.
 */
export function useLiveUpdates(enabled: boolean, onNotification: (n: LiveNotification) => void): LiveState {
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>('connecting');

  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | null = null;
    let retry = 0;
    let timer: number | undefined;
    let fallback: number | undefined;
    let closed = false;

    const refreshAll = () => {
      invalidateWork(qc);
      invalidateEvents(qc);
      invalidateProfit(qc);
      void qc.invalidateQueries({ queryKey: keys.notifications });
      void qc.invalidateQueries({ queryKey: keys.notes });
    };

    const connect = () => {
      source = new EventSource('/api/stream');
      source.addEventListener('ready', () => {
        if (retry > 0) refreshAll();
        retry = 0;
        setState('live');
        window.clearInterval(fallback);
      });
      source.addEventListener('change', (e) => {
        const { topics, notification } = JSON.parse((e as MessageEvent).data) as { topics: Topic[]; notification: LiveNotification | null };
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
        if (notification) onNotification(notification);
      });
      source.onerror = () => {
        source?.close();
        if (closed) return;
        setState('reconnecting');
        window.clearInterval(fallback);
        fallback = window.setInterval(refreshAll, 30_000);
        retry += 1;
        timer = window.setTimeout(connect, Math.min(1000 * 2 ** retry, 30_000));
      };
    };
    connect();
    return () => {
      closed = true;
      source?.close();
      window.clearTimeout(timer);
      window.clearInterval(fallback);
    };
    // onNotification is intentionally excluded: it is stable per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, qc]);

  return state;
}
