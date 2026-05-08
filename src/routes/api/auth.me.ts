import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import {
  getCurrentUser,
  isMultiTenantAuthEnabled,
} from '../../server/auth-middleware'
import { listActionsForUser } from '../../server/permissions'
import { getMember, getWorkspaceMeta, isWorkspaceActive, listWorkspaces } from '../../server/workspace-store'

/**
 * GET /api/auth/me — return the logged-in user, the workspaces they
 * are a member of (with their role), and the action set for the
 * currently-active workspace. Returns 401 in multi-tenant mode when
 * not logged in, or `{ user: null, ... }` in legacy mode.
 */
export const Route = createFileRoute('/api/auth/me')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isMultiTenantAuthEnabled()) {
          return json({ ok: true, user: null, mode: 'legacy', memberships: [], actions: [] })
        }
        const user = getCurrentUser(request)
        if (!user) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const memberships = listWorkspaces()
          .map((wsId) => {
            const meta = getWorkspaceMeta(wsId)
            if (!isWorkspaceActive(meta)) return null
            const member = getMember(wsId, user.id)
            if (!member) return null
            return {
              workspaceId: wsId,
              name: meta!.name,
              role: member.role,
              branding: meta!.branding,
              joinedAt: member.joinedAt,
            }
          })
          .filter((m): m is NonNullable<typeof m> => m !== null)
        const activeWs = user.defaultWorkspaceId
        const actions = activeWs ? listActionsForUser(user.id, activeWs) : []
        return json({
          ok: true,
          mode: 'multi-tenant',
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            status: user.status,
            mustChangePassword: user.mustChangePassword === true,
            defaultWorkspaceId: user.defaultWorkspaceId,
            lastLoginAt: user.lastLoginAt,
          },
          memberships,
          activeWorkspaceId: activeWs,
          actions,
        })
      },
    },
  },
})
