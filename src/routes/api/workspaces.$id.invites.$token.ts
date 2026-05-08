import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { requirePermission } from '../../server/auth-middleware'
import { appendAuditEvent } from '../../server/audit-log'
import { getInvite, revokeInvite } from '../../server/invites-store'

/**
 * DELETE /api/workspaces/$id/invites/$token — revoke a pending invite.
 * Refuses to revoke an invite that doesn't belong to the workspace
 * (so an admin in WS-A can't poke around tokens in WS-B by guessing).
 */
export const Route = createFileRoute('/api/workspaces/$id/invites/$token')({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        const guard = requirePermission(request, params.id, 'members-manage')
        if (!guard.ok) return guard.response
        const invite = getInvite(params.token)
        if (!invite) {
          return json({ ok: false, error: 'Invite not found' }, { status: 404 })
        }
        if (invite.workspaceId !== params.id) {
          // Don't leak existence — same response shape as not-found.
          return json({ ok: false, error: 'Invite not found' }, { status: 404 })
        }
        const revoked = await revokeInvite(params.token)
        if (!revoked) {
          return json({ ok: false, error: 'Invite already used or missing' }, { status: 410 })
        }
        await appendAuditEvent(
          { type: 'workspace', wsId: params.id },
          {
            type: 'invite_revoked',
            actorUserId: guard.value.user.id,
            inviteToken: params.token,
          },
        )
        return json({ ok: true })
      },
    },
  },
})
