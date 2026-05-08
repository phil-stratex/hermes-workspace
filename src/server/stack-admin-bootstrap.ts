/**
 * One-shot Stack-Admin bootstrap.
 *
 * Multi-tenant migration creates the first workspace owner but does
 * NOT mark anyone as Stack-Admin (Stack-Admin lives outside the
 * per-workspace permission model — see `permissions.ts`). Without
 * intervention, a freshly-migrated stack ends up with `stackAdmins=[]`,
 * which means `canSeeErrors` returns false for everyone in multi-tenant
 * mode and the Errors-UI is locked out.
 *
 * This bootstrap fixes that by promoting the oldest workspace owner
 * across all workspaces (sorted by `joinedAt asc`) the first time it
 * runs — but only if `stackAdmins=[]`. Subsequent runs are no-ops.
 *
 * Idempotent. Safe to call repeatedly. Audit event
 * `stack_admin_bootstrap_promoted` records the promotion with
 * `triggeredBy:'system'`, `triggeredVia:'bootstrap'`.
 *
 * Where to call: from `server-entry.js` after `assertCoherentBootState()`
 * succeeds, before the HTTP server begins listening.
 */

import { isMultiTenantAuthEnabled } from './auth-middleware'
import {
  addStackAdmin,
  getStackAdmins,
} from './global-settings'
import {
  getWorkspaceMembers,
  listWorkspaces,
} from './workspace-store'
import type { WorkspaceMember } from './workspace-store'

export type BootstrapResult =
  | { action: 'skipped'; reason: 'legacy-mode' | 'already-populated' | 'no-owner-found' }
  | { action: 'promoted'; userId: string; sourceWorkspaceId: string }

export async function bootstrapStackAdminsIfNeeded(): Promise<BootstrapResult> {
  if (!isMultiTenantAuthEnabled()) {
    return { action: 'skipped', reason: 'legacy-mode' }
  }
  if (getStackAdmins().length > 0) {
    return { action: 'skipped', reason: 'already-populated' }
  }

  // Find the oldest owner across all workspaces. We use `joinedAt` on
  // the membership rather than the workspace `createdAt` so a freshly-
  // migrated single-workspace stack picks the original migration owner
  // unambiguously.
  type Candidate = { userId: string; joinedAt: number; workspaceId: string }
  const owners: Array<Candidate> = []
  for (const wsId of listWorkspaces()) {
    const members = getWorkspaceMembers(wsId)
    for (const m of members.members as Array<WorkspaceMember>) {
      if (m.role !== 'owner') continue
      const ts = Date.parse(m.joinedAt)
      if (!Number.isFinite(ts)) continue
      owners.push({ userId: m.userId, joinedAt: ts, workspaceId: wsId })
    }
  }
  if (owners.length === 0) {
    return { action: 'skipped', reason: 'no-owner-found' }
  }
  owners.sort((a, b) => a.joinedAt - b.joinedAt)
  const target = owners[0]
  await addStackAdmin(target.userId, 'system', 'bootstrap')
  return { action: 'promoted', userId: target.userId, sourceWorkspaceId: target.workspaceId }
}
