import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { getInvite, isInviteValid } from '../../server/invites-store'
import { getWorkspaceMeta, isWorkspaceActive } from '../../server/workspace-store'
import { getClientIp, rateLimit, rateLimitResponse } from '../../server/rate-limit'

/**
 * GET /api/invites/$token/info — public, no auth.
 *
 * Used by the InviteAcceptScreen to render "Phil hat dich als Member
 * eingeladen". Returns minimal info — no listing of other workspace
 * members or any other side data — and `valid: false` for any
 * malformed / expired / used / unknown token.
 */
export const Route = createFileRoute('/api/invites/$token/info')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const ip = getClientIp(request)
        if (!rateLimit(`invite:info:${ip}`, 30, 60_000)) return rateLimitResponse()
        try {
          const invite = getInvite(params.token)
          if (!invite || !isInviteValid(invite)) {
            return json({ ok: true, valid: false })
          }
          const ws = getWorkspaceMeta(invite.workspaceId)
          if (!isWorkspaceActive(ws)) {
            return json({ ok: true, valid: false, reason: 'workspace-unavailable' })
          }
          return json({
            ok: true,
            valid: true,
            workspace: { id: ws!.id, name: ws!.name, branding: ws!.branding },
            email: invite.email,
            role: invite.role,
            expiresAt: invite.expiresAt,
          })
        } catch {
          return json({ ok: true, valid: false })
        }
      },
    },
  },
})
