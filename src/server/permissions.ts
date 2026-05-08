/**
 * Workspace permissions truth-table.
 *
 * `canDo(userId, wsId, action) → boolean` is the single decision point
 * every mutating route consults via `requirePermission(req, wsId,
 * action)`. The lookup is O(1) thanks to the `members.json` mtime
 * cache in `workspace-store.ts`.
 *
 * The action matrix mirrors the spec's Section A.3:
 *
 *   action               | owner | admin | member
 *   ─────────────────────┼───────┼───────┼────────
 *   chat                 |   ✓   |   ✓   |   ✓
 *   memory-read          |   ✓   |   ✓   |   ✓
 *   memory-write         |   ✓   |   ✓   |   ✓
 *   memory-hard-delete   |   ✓   |   ✓   |   —
 *   skills-read          |   ✓   |   ✓   |   ✓
 *   skills-edit          |   ✓   |   ✓   |   —
 *   roster-edit          |   ✓   |   ✓   |   —
 *   worker-control       |   ✓   |   ✓   |   ✓
 *   session-share        |   ✓   |   ✓   |   ✓ (own only)
 *   workspace-settings   |   ✓   |   ✓   |   —
 *   members-manage       |   ✓   |   ✓   |   —
 *   federation-manage    |   ✓   |   ✓   |   —
 *   audit-view           |   ✓   |   ✓   |   —
 *   user-pw-reset        |   ✓   |   ✓   |   —
 *   workspace-delete     |   ✓   |   —   |   —
 *   owner-handover       |   ✓   |   —   |   —
 *   view-usage           |   ✓   |   ✓   |   ✓
 *
 * The `session-share` "own only" caveat is enforced at the route layer
 * (the route knows `ownerId`); `canDo` only gates the verb, not the
 * resource ownership.
 *
 * Soft-deleted workspaces (`meta.deletedAt`) deny all actions including
 * for the owner — explicit restore-then-act is required. This makes
 * the soft-delete state cache-invalidation test (Plan AK29) work
 * across the whole permission surface, not just the routes that
 * happen to check `deletedAt` themselves.
 */

import { getMember, getWorkspaceMeta, isWorkspaceActive } from './workspace-store'
import type { WorkspaceRole } from './workspace-store'

export type Action =
  | 'chat'
  | 'memory-read'
  | 'memory-write'
  | 'memory-hard-delete'
  | 'skills-read'
  | 'skills-edit'
  | 'roster-edit'
  | 'worker-control'
  | 'session-share'
  | 'workspace-settings'
  | 'members-manage'
  | 'federation-manage'
  | 'audit-view'
  | 'user-pw-reset'
  | 'workspace-delete'
  | 'owner-handover'
  | 'view-usage'

const TABLE: Record<Action, ReadonlyArray<WorkspaceRole>> = {
  'chat':                ['owner', 'admin', 'member'],
  'memory-read':         ['owner', 'admin', 'member'],
  'memory-write':        ['owner', 'admin', 'member'],
  'memory-hard-delete':  ['owner', 'admin'],
  'skills-read':         ['owner', 'admin', 'member'],
  'skills-edit':         ['owner', 'admin'],
  'roster-edit':         ['owner', 'admin'],
  'worker-control':      ['owner', 'admin', 'member'],
  'session-share':       ['owner', 'admin', 'member'],
  'workspace-settings':  ['owner', 'admin'],
  'members-manage':      ['owner', 'admin'],
  'federation-manage':   ['owner', 'admin'],
  'audit-view':          ['owner', 'admin'],
  'user-pw-reset':       ['owner', 'admin'],
  'workspace-delete':    ['owner'],
  'owner-handover':      ['owner'],
  'view-usage':          ['owner', 'admin', 'member'],
}

export function getRoleForUser(userId: string, wsId: string): WorkspaceRole | null {
  return getMember(wsId, userId)?.role ?? null
}

/**
 * Returns true iff:
 *   1. the workspace exists and is not soft-deleted,
 *   2. the user is a member,
 *   3. the user's role is in the permitted set for `action`.
 *
 * Returns false (not throws) on any negative — callers map that to
 * 401/403/404 as appropriate.
 */
export function canDo(userId: string, wsId: string, action: Action): boolean {
  const meta = getWorkspaceMeta(wsId)
  if (!isWorkspaceActive(meta)) return false
  const role = getRoleForUser(userId, wsId)
  if (!role) return false
  const permitted = TABLE[action]
  if (!permitted) return false
  return permitted.includes(role)
}

/**
 * Returns the full action set the user can perform in the workspace —
 * useful for the UI to decide which buttons / menu items to render.
 * Empty array means non-member or soft-deleted workspace.
 */
export function listActionsForUser(userId: string, wsId: string): Array<Action> {
  const meta = getWorkspaceMeta(wsId)
  if (!isWorkspaceActive(meta)) return []
  const role = getRoleForUser(userId, wsId)
  if (!role) return []
  const out: Array<Action> = []
  for (const [action, roles] of Object.entries(TABLE) as Array<
    [Action, ReadonlyArray<WorkspaceRole>]
  >) {
    if (roles.includes(role)) out.push(action)
  }
  return out
}
