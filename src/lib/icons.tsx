import { Icon as Iconify, addCollection } from '@iconify/react';
import solar from './solar-subset.json';

// Solar icons (CC BY 4.0, 480 Design) bundled offline — no runtime icon API.
addCollection(solar as Parameters<typeof addCollection>[0]);

export const ICON_MAP = {
  home: 'home-2-linear',
  homeActive: 'home-2-bold',
  calendar: 'calendar-linear',
  calendarActive: 'calendar-bold',
  tasks: 'checklist-linear',
  tasksActive: 'checklist-bold',
  projects: 'folder-with-files-linear',
  projectsActive: 'folder-with-files-bold',
  clients: 'case-round-linear',
  clientsActive: 'case-round-bold',
  profit: 'wallet-money-linear',
  profitActive: 'wallet-money-bold',
  team: 'users-group-rounded-linear',
  settings: 'settings-linear',
  settingsActive: 'settings-bold',
  add: 'add-circle-linear',
  plus: 'add-square-linear',
  left: 'alt-arrow-left-linear',
  right: 'alt-arrow-right-linear',
  down: 'alt-arrow-down-linear',
  back: 'arrow-left-linear',
  close: 'close-circle-linear',
  x: 'close-square-linear',
  check: 'check-circle-linear',
  checkFilled: 'check-circle-bold',
  refresh: 'refresh-linear',
  chat: 'chat-round-dots-linear',
  clock: 'clock-circle-linear',
  invite: 'user-plus-rounded-linear',
  warning: 'danger-triangle-linear',
  alert: 'danger-circle-linear',
  flag: 'flag-linear',
  checklist: 'checklist-minimalistic-linear',
  trash: 'trash-bin-minimalistic-linear',
  edit: 'pen-linear',
  eye: 'eye-linear',
  eyeClosed: 'eye-closed-linear',
  signOut: 'logout-2-linear',
  filter: 'filter-linear',
  copy: 'copy-linear',
  shield: 'shield-check-linear',
  mail: 'letter-linear',
  mailOpen: 'letter-opened-linear',
  devices: 'monitor-smartphone-linear',
  monitor: 'monitor-linear',
  phone: 'smartphone-linear',
  history: 'history-linear',
  undo: 'undo-left-linear',
  more: 'menu-dots-bold',
  menu: 'hamburger-menu-linear',
  send: 'arrow-up-linear',
  stop: 'stop-circle-linear',
  sun: 'sun-2-linear',
  moon: 'moon-linear',
  camera: 'camera-linear',
  target: 'target-linear',
  inbox: 'inbox-linear',
  info: 'info-circle-linear',
  lock: 'lock-keyhole-minimalistic-linear',
  unlock: 'lock-keyhole-minimalistic-unlocked-linear',
  key: 'key-linear',
  admin: 'crown-minimalistic-linear',
  arrowRight: 'arrow-right-linear',
  external: 'square-arrow-right-up-linear',
  link: 'link-linear',
  calendarAdd: 'calendar-add-linear',
  calendarMark: 'calendar-mark-linear',
  dollar: 'dollar-minimalistic-linear',
  grid: 'widget-linear',
  board: 'widget-4-linear',
  list: 'list-linear',
  remove: 'minus-circle-linear',
  user: 'user-rounded-linear',
  userCheck: 'user-check-rounded-linear',
  people: 'users-group-two-rounded-linear',
  bell: 'bell-linear',
  bellActive: 'bell-bold',
  search: 'magnifer-linear',
  repeat: 'repeat-linear',
  location: 'map-point-linear',
  download: 'download-minimalistic-linear',
  globe: 'global-linear',
  note: 'document-text-linear',
  notes: 'notes-linear',
  notesActive: 'notes-bold',
  chatSquare: 'chat-square-linear',
  palette: 'palette-linear',
  database: 'database-linear',
  chart: 'chart-2-linear',
  quickAdd: 'widget-add-linear',
  agenda: 'sort-by-time-linear',
  clipboard: 'clipboard-list-linear',
  pin: 'pin-linear',
} as const;

export type IconName = keyof typeof ICON_MAP;

export function Icon({ name, size = 18, className, label }: { name: IconName; size?: number; className?: string; label?: string }) {
  return (
    <Iconify
      icon={`solar:${ICON_MAP[name]}`}
      width={size}
      height={size}
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  );
}

/**
 * Lume's mark: a small lens with an orbiting point. When `active`, the point
 * travels the orbit (CSS, disabled under reduced motion) to show Lume is working.
 */
export function LumeMark({ size = 20, active = false, className = '' }: { size?: number; active?: boolean; className?: string }) {
  return (
    <svg className={`lume-mark ${active ? 'is-active' : ''} ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="4.2" fill="currentColor" />
      <g className="lume-orbit">
        <circle cx="12" cy="3.6" r="1.9" fill="currentColor" />
      </g>
    </svg>
  );
}
