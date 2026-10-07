// Who added a record, shown wherever the team sees tasks, events and notes.
import { Avatar } from './ui.tsx';
import { useMembers } from '../lib/queries.ts';
import { firstName, relativeTime } from '../lib/format.ts';

export function useMemberLookup() {
  const members = useMembers().data ?? [];
  return (id: string | null | undefined) => (id ? (members.find((m) => m.id === id) ?? { id, name: 'Former member', avatarUrl: null }) : null);
}

/**
 * - inline: small photo + name ("Maya", or "Added by Maya" with showVerb)
 * - avatar: the photo only, for tight spots such as calendar chips
 * - text: "Added by Maya Chen · 2h ago"
 */
export function AddedBy({
  userId,
  at,
  variant = 'inline',
  verb = 'Added by',
  full = false,
  showVerb = false,
}: {
  userId: string | null | undefined;
  at?: string;
  variant?: 'inline' | 'avatar' | 'text';
  verb?: string;
  full?: boolean;
  showVerb?: boolean;
}) {
  const who = useMemberLookup()(userId);
  if (!who) return null;
  const name = full ? who.name : firstName(who.name);
  const title = `${verb} ${who.name}${at ? ` · ${relativeTime(at)}` : ''}`;
  if (variant === 'avatar')
    return (
      <span className="added-by is-avatar" title={title}>
        <span aria-hidden="true">
          <Avatar member={who} size={14} />
        </span>
        <span className="sr-only">{title}</span>
      </span>
    );
  if (variant === 'text')
    return (
      <span className="added-by is-text" title={title}>
        {verb} <strong>{name}</strong>
        {at && <time dateTime={at}> · {relativeTime(at)}</time>}
      </span>
    );
  return (
    <span className="added-by" title={title}>
      <span aria-hidden="true">
        <Avatar member={who} size={16} />
      </span>
      {!showVerb && <span className="sr-only">{verb} </span>}
      <span className="added-by-name">
        {showVerb && `${verb} `}
        {name}
      </span>
    </span>
  );
}
