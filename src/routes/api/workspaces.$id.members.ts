import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { requirePermission } from '../../server/auth-middleware'
import { listPendingInvitesForWorkspace } from '../../server/invites-store'
import { getUserProfile } from '../../server/users-store'
import { getWorkspaceMembers } from '../../server/workspace-store'

/**
 * GET /api/workspaces/$id/members — list members + pending invites.
 * Admin/Owner only (members-manage gate).
 */
export const Route = createFileRoute('/api/workspaces/$id/members')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const guard = requirePermission(request, params.id, 'members-manage')
        if (!guard.ok) return guard.response

        const members = getWorkspaceMembers(params.id).members.map((m) => {
          const profile = getUserProfile(m.userId)
          return {
            userId: m.userId,
            role: m.role,
            joinedAt: m.joinedAt,
            addedBy: m.addedBy,
            email: profile?.email,
            name: profile?.name,
            status: profile?.status,
            failedLoginCount: profile?.failedLoginCount,
            lastLoginAt: profile?.lastLoginAt,
            lastFailedLoginAt: profile?.lastFailedLoginAt,
          }
        })
        const pendingInvites = listPendingInvitesForWorkspace(params.id).map((i) => ({
          token: i.token,
          email: i.email,
          role: i.role,
          createdAt: i.createdAt,
          expiresAt: i.expiresAt,
          invitedBy: i.invitedBy,
        }))
        return json({ ok: true, members, pendingInvites })
      },
    },
  },
})
