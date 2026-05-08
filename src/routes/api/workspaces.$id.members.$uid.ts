import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'

import { requirePermission } from '../../server/auth-middleware'
import { appendAuditEvent } from '../../server/audit-log'
import { isValidSlug } from '../../server/data-paths'
import { requireJsonContentType } from '../../server/rate-limit'
import { changeMemberRole, removeMember } from '../../server/workspace-store'

const PatchSchema = z.object({
  role: z.enum(['owner', 'admin', 'member']),
})

const DeleteQuerySchema = z.object({
  // Two member-removal modes (D1):
  //   transfer  — sessions move to `transferTo` userId
  //   delete    — caller-side route (sessions.ts) deletes the gateway-side
  //               sessions; this route only removes the membership.
  //   omit      — remove membership only; no session action (default,
  //               UI presents the choice explicitly).
  sessions: z.enum(['transfer', 'delete']).optional(),
  transferTo: z.string().optional(),
})

export const Route = createFileRoute('/api/workspaces/$id/members/$uid')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        const guard = requirePermission(request, params.id, 'members-manage')
        if (!guard.ok) return guard.response
        if (!isValidSlug(params.uid)) {
          return json({ ok: false, error: 'Invalid uid' }, { status: 400 })
        }
        const raw = await request.json().catch(() => ({}))
        const parsed = PatchSchema.safeParse(raw)
        if (!parsed.success) {
          return json({ ok: false, error: 'Invalid request' }, { status: 400 })
        }
        // Promoting to owner needs the stronger owner-handover gate.
        if (parsed.data.role === 'owner') {
          const handoverGuard = requirePermission(request, params.id, 'owner-handover')
          if (!handoverGuard.ok) return handoverGuard.response
        }
        try {
          const next = await changeMemberRole(params.id, params.uid, parsed.data.role)
          await appendAuditEvent(
            { type: 'workspace', wsId: params.id },
            {
              type: 'member_role_changed',
              targetUserId: params.uid,
              newRole: parsed.data.role,
              actorUserId: guard.value.user.id,
            },
          )
          return json({ ok: true, members: next.members })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : 'failed' },
            { status: 400 },
          )
        }
      },
      DELETE: async ({ request, params }) => {
        const guard = requirePermission(request, params.id, 'members-manage')
        if (!guard.ok) return guard.response
        if (!isValidSlug(params.uid)) {
          return json({ ok: false, error: 'Invalid uid' }, { status: 400 })
        }
        const url = new URL(request.url)
        const queryParsed = DeleteQuerySchema.safeParse({
          sessions: url.searchParams.get('sessions') ?? undefined,
          transferTo: url.searchParams.get('transferTo') ?? undefined,
        })
        if (!queryParsed.success) {
          return json({ ok: false, error: 'Invalid query' }, { status: 400 })
        }
        if (queryParsed.data.sessions === 'transfer' && !queryParsed.data.transferTo) {
          return json({ ok: false, error: 'transferTo required when sessions=transfer' }, { status: 400 })
        }

        try {
          const next = await removeMember(params.id, params.uid)
          await appendAuditEvent(
            { type: 'workspace', wsId: params.id },
            {
              type: 'member_removed',
              targetUserId: params.uid,
              actorUserId: guard.value.user.id,
              sessionsAction: queryParsed.data.sessions ?? 'none',
              transferTo: queryParsed.data.transferTo,
            },
          )
          // NOTE: The actual session transfer/delete happens in
          // sessions-privacy.ts (next phase). This route signals intent
          // via the audit event; the UI follows up with the appropriate
          // sessions endpoint call.
          return json({
            ok: true,
            members: next.members,
            sessionsAction: queryParsed.data.sessions ?? 'none',
          })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : 'failed' },
            { status: 400 },
          )
        }
      },
    },
  },
})
