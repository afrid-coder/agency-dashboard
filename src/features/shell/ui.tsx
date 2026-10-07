// App-wide UI state: which record panels and creation dialogs are open.
// Record panels are driven by the URL (?task=…), so links from Lume,
// notifications and teammates open the same view.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { EventOccurrence, Note, ProfitEntry, Project } from '../../../shared/types.ts';

export interface TaskDefaults {
  dueDate?: string | null;
  projectId?: string | null;
  assigneeIds?: string[];
  status?: 'todo' | 'in_progress' | 'review' | 'done';
}
export interface EventDefaults {
  date?: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  projectId?: string | null;
}

interface UI {
  taskId: string | null;
  openTask: (id: string) => void;
  closeTask: () => void;
  newTask: TaskDefaults | null;
  openNewTask: (d?: TaskDefaults) => void;
  closeNewTask: () => void;
  eventEditor: { occurrence: EventOccurrence | null; defaults: EventDefaults; scope: 'series' | 'occurrence' } | null;
  openNewEvent: (d?: EventDefaults) => void;
  editEvent: (o: EventOccurrence, scope: 'series' | 'occurrence') => void;
  closeEventEditor: () => void;
  eventDetails: EventOccurrence | null;
  showEvent: (o: EventOccurrence | null) => void;
  projectEditor: { project: Project | null } | null;
  openProjectEditor: (p?: Project | null) => void;
  closeProjectEditor: () => void;
  profitEditor: { entry: ProfitEntry | null; projectId?: string | null } | null;
  openProfitEditor: (entry?: ProfitEntry | null, projectId?: string | null) => void;
  closeProfitEditor: () => void;
  noteEditor: { note: Note | null } | null;
  openNote: (note?: Note | null) => void;
  closeNote: () => void;
  lume: { open: boolean; prompt: string | null };
  openLume: (prompt?: string) => void;
  closeLume: () => void;
  consumeLumePrompt: () => void;
}

const Ctx = createContext<UI | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const [newTask, setNewTask] = useState<TaskDefaults | null>(null);
  const [eventEditor, setEventEditor] = useState<UI['eventEditor']>(null);
  const [eventDetails, setEventDetails] = useState<EventOccurrence | null>(null);
  const [projectEditor, setProjectEditor] = useState<UI['projectEditor']>(null);
  const [profitEditor, setProfitEditor] = useState<UI['profitEditor']>(null);
  const [noteEditor, setNoteEditor] = useState<UI['noteEditor']>(null);
  const [lume, setLume] = useState<UI['lume']>({ open: false, prompt: null });

  const setParam = useCallback(
    (key: string, value: string | null) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (value === null) p.delete(key);
          else p.set(key, value);
          return p;
        },
        { replace: value === null },
      ),
    [setParams],
  );

  const value = useMemo<UI>(
    () => ({
      taskId: params.get('task'),
      openTask: (id) => setParam('task', id),
      closeTask: () => setParam('task', null),
      newTask,
      openNewTask: (d = {}) => setNewTask(d),
      closeNewTask: () => setNewTask(null),
      eventEditor,
      openNewEvent: (d = {}) => setEventEditor({ occurrence: null, defaults: d, scope: 'series' }),
      editEvent: (occurrence, scope) => setEventEditor({ occurrence, defaults: {}, scope }),
      closeEventEditor: () => setEventEditor(null),
      eventDetails,
      showEvent: setEventDetails,
      projectEditor,
      openProjectEditor: (project = null) => setProjectEditor({ project }),
      closeProjectEditor: () => setProjectEditor(null),
      profitEditor,
      openProfitEditor: (entry = null, projectId = null) => setProfitEditor({ entry, projectId }),
      closeProfitEditor: () => setProfitEditor(null),
      noteEditor,
      openNote: (note = null) => setNoteEditor({ note }),
      closeNote: () => setNoteEditor(null),
      lume,
      openLume: (prompt) => setLume({ open: true, prompt: prompt ?? null }),
      closeLume: () => setLume((l) => ({ ...l, open: false })),
      consumeLumePrompt: () => setLume((l) => ({ ...l, prompt: null })),
    }),
    [params, setParam, newTask, eventEditor, eventDetails, projectEditor, profitEditor, noteEditor, lume],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUI() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useUI must be used inside UIProvider');
  return ctx;
}
