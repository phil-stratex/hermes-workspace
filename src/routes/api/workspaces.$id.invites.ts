import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'

import { requirePermission } from '../../server/auth-middleware'
import { appendAuditEvent } from '../../server/audit-log'
import { createInvite, listPendingInvitesForWorkspace } from '../../server/invites-store'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'

const CreateSchema = z.object({
  email: z.string().email().max(320).optional(),
  role: z.enum(['admin', 'member']),
  ttlDays: z.number().int().min(1).max(30).optional(),
})

export const Route = createFileRoute('/api/workspaces/$id/invites')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const guard = requirePermission(request, params.id, 'members-manage')
        if (!guard.ok) return guard.response
        const invites = listPendingInvitesForWorkspace(params.id).map((i) => ({
          token: i.token,
          email: i.email,
          role: i.role,
          createdAt: i.createdAt,
          expiresAt: i.expiresAt,
          invitedBy: i.invitedBy,
        }))
        return json({ ok: true, invites })
      },
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        const guard = requirePermission(request, params.id, 'members-manage')
        if (!guard.ok) return guard.response
        // 10 invites/min per admin per IP
        const ip = getClientIp(request)
        if (!rateLimit(`invite:create:${guard.value.user.id}:${ip}`, 10, 60_000)) {
          return rateLimitResponse()
        }
        const raw = await request.json().catch(() => ({}))
        const parsed = CreateSchema.safeParse(raw)
        if (!parsed.success) {
          return json({ ok: false, error: 'Invalid request' }, { status: 400 })
        }
        const invite = await createInvite({
          workspaceId: params.id,
          email: parsed.data.email,
          role: parsed.data.role,
          invitedBy: guard.value.user.id,
          ttlDays: parsed.data.ttlDays,
        })
        await appendAuditEvent(
          { type: 'workspace', wsId: params.id },
          {
            type: 'invite_created',
            actorUserId: guard.value.user.id,
            inviteToken: invite.token,
            email: invite.email,
            role: invite.role,
          },
        )
        return json({
          ok: true,
          invite: {
            token: invite.token,
            inviteUrl: `/invite/${invite.token}`,
            email: invite.email,
            role: invite.role,
            expiresAt: invite.expiresAt,
          },
        })
      },
    },
  },
})
