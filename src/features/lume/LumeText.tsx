// Renders Lume's plain-text answers: paragraphs, "- " lists, **bold**,
// record links ([[task:id]] → a chip showing the record's title) and
// labelled "Suggestion:" / "Estimate:" callouts. No HTML is ever injected.
import { Fragment, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Icon, type IconName } from '../../lib/icons.tsx';
import { useUI } from '../shell/ui.tsx';
import type { RecordRef } from '../../../shared/types.ts';

const ICON: Record<RecordRef['type'], IconName> = { task: 'tasks', event: 'calendar', project: 'projects', client: 'clients', profit: 'profit', note: 'note' };

export function RecordChip({ r }: { r: RecordRef }) {
  const ui = useUI();
  const navigate = useNavigate();
  return (
    <a
      href={r.href}
      className={`record-chip is-${r.type}`}
      onClick={(e) => {
        e.preventDefault();
        if (r.type === 'task') ui.openTask(r.id);
        else navigate(r.href);
      }}
      title={r.subtitle ? `${r.title} · ${r.subtitle}` : r.title}
    >
      <Icon name={ICON[r.type]} size={13} />
      <span>{r.title}</span>
    </a>
  );
}

function inline(text: string, refs: Map<string, RecordRef>, key: string): ReactNode[] {
  // Hide a token that is still streaming in ("[[task:ab").
  const safe = text.replace(/\[\[[^\]]*$/, '');
  const parts = safe.split(/(\[\[(?:task|event|project|client|profit|note):[A-Za-z0-9-]+\]\]|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const k = `${key}-${i}`;
    const tok = /^\[\[(\w+):([\w-]+)\]\]$/.exec(p);
    if (tok) {
      const r = refs.get(`${tok[1]}:${tok[2]}`);
      return r ? <RecordChip key={k} r={r} /> : null;
    }
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={k}>{p.slice(2, -2)}</strong>;
    return <Fragment key={k}>{p}</Fragment>;
  });
}

export function LumeText({ text, refs }: { text: string; refs: RecordRef[] }) {
  const map = new Map(refs.map((r) => [`${r.type}:${r.id}`, r]));
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim());
  return (
    <div className="lume-text">
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter((l) => l.trim());
        const callout = /^(Suggestion|Estimate):\s*/i.exec(lines[0] ?? '');
        if (callout) {
          const kind = callout[1].toLowerCase();
          return (
            <div key={bi} className={`lume-callout is-${kind}`}>
              <span className="lume-callout-label">{kind === 'suggestion' ? 'Suggestion' : 'Estimate'}</span>
              <p>{inline([lines[0].slice(callout[0].length), ...lines.slice(1)].join(' '), map, `b${bi}`)}</p>
            </div>
          );
        }
        if (lines.every((l) => /^\s*[-•]\s+/.test(l)))
          return (
            <ul key={bi}>
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*[-•]\s+/, ''), map, `b${bi}l${li}`)}</li>
              ))}
            </ul>
          );
        // A heading line followed by a list ("Due today:\n- …").
        if (lines.length > 1 && lines.slice(1).every((l) => /^\s*[-•]\s+/.test(l)))
          return (
            <div key={bi}>
              <p>{inline(lines[0], map, `b${bi}h`)}</p>
              <ul>
                {lines.slice(1).map((l, li) => (
                  <li key={li}>{inline(l.replace(/^\s*[-•]\s+/, ''), map, `b${bi}l${li}`)}</li>
                ))}
              </ul>
            </div>
          );
        return <p key={bi}>{inline(lines.join(' '), map, `b${bi}`)}</p>;
      })}
    </div>
  );
}
