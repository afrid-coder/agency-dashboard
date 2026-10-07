// One permission model, used by the server to authorize every request and
// by the interface to hide controls a person cannot use.

export type Role = 'owner' | 'admin' | 'member';
export const ROLES: Role[] = ['owner', 'admin', 'member'];

export type Permission =
  | 'workspace.manage' // name, timezone, defaults
  | 'members.invite'
  | 'members.manage' // change roles, remove people
  | 'members.manageOwners' // grant or remove the owner role
  | 'finance.viewSummary' // monthly goal progress (if the workspace allows members to see it)
  | 'finance.viewEntries'
  | 'finance.record'
  | 'finance.edit'
  | 'finance.setTarget'
  | 'data.export'
  | 'tasks.deleteAny'
  | 'projects.delete'
  | 'clients.delete'
  | 'lume.teamBriefing';

const ADMIN: Permission[] = [
  'workspace.manage',
  'members.invite',
  'members.manage',
  'finance.viewSummary',
  'finance.viewEntries',
  'finance.record',
  'finance.edit',
  'finance.setTarget',
  'data.export',
  'tasks.deleteAny',
  'projects.delete',
  'clients.delete',
  'lume.teamBriefing',
];

const GRANTS: Record<Role, Set<Permission>> = {
  owner: new Set<Permission>([...ADMIN, 'members.manageOwners']),
  admin: new Set<Permission>(ADMIN),
  member: new Set<Permission>([]),
};

export interface PermissionContext {
  role: Role;
  membersSeeProfit: boolean;
}

export function can(ctx: PermissionContext, permission: Permission): boolean {
  if (permission === 'finance.viewSummary' && ctx.role === 'member') return ctx.membersSeeProfit;
  return GRANTS[ctx.role].has(permission);
}

export function permissionsFor(ctx: PermissionContext): Permission[] {
  const all = new Set<Permission>([...GRANTS.owner]);
  return [...all].filter((p) => can(ctx, p));
}

export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };
export const ROLE_SUMMARY: Record<Role, string> = {
  owner: 'Everything admins can do, plus granting or removing ownership.',
  admin: 'Manages people, workspace settings, profit records, targets and exports.',
  member: 'Works with clients, projects, tasks and the calendar. Sees goal progress if the workspace allows it.',
};
