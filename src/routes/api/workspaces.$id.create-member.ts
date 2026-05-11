import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'

import { requirePermission } from '../../server/auth-middleware'
import { appendAuditEvent } from '../../server/audit-log'
import { hashPassword } from '../../server/auth-passwords'
import { isValidSlug } from '../../server/data-paths'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'
import {
  createUser,
  getUserProfile,
  listUsers,
  setPasswordHash,
} from '../../server/users-store'
import {
  addMember,
  getMember,
  getWorkspaceMeta,
  isWorkspaceActive,
} from '../../server/workspace-store'

const CreateMemberSchema = z.object({
  userId: z.string().min(2).max(64),
  name: z.string().min(1).max(200),
  email: z.string().email().max(320).optional(),
  password: z.string().min(8).max(1000),
  role: z.enum(['admin', 'member']),
})

export const Route = createFileRoute('/api/workspaces/$id/create-member')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const guard = requirePermission(request, params.id, 'members-manage')
        if (!guard.ok) return guard.response

        // 10 account-creations/min per admin per IP — same rate as invites.
        const ip = getClientIp(request)
        if (!rateLimit(`create-member:${guard.value.user.id}:${ip}`, 10, 60_000)) {
          return rateLimitResponse()
        }

        const raw = await request.json().catch(() => ({}))
        const parsed = CreateMemberSchema.safeParse(raw)
        if (!parsed.success) {
          return json({ ok: false, error: 'Invalid request' }, { status: 400 })
        }
        if (!isValidSlug(parsed.data.userId)) {
          return json(
            { ok: false, error: 'Invalid userId (lowercase slug expected)' },
            { status: 400 },
          )
        }

        const ws = getWorkspaceMeta(params.id)
        if (!isWorkspaceActive(ws)) {
          return json({ ok: false, error: 'Workspace unavailable' }, { status: 410 })
        }

        if (listUsers().includes(parsed.data.userId) || getUserProfile(parsed.data.userId)) {
          return json({ ok: false, error: 'User id already taken' }, { status: 409 })
        }
        if (getMember(params.id, parsed.data.userId)) {
          return json(
            { ok: false, error: 'Already a member of this workspace' },
            { status: 409 },
          )
        }

        // Atomically: create user → set password → add as member → audit.
        await createUser({
          id: parsed.data.userId,
          email: parsed.data.email ?? `${parsed.data.userId}@local`,
          name: parsed.data.name,
          status: 'active',
          mustChangePassword: false,
          defaultWorkspaceId: params.id,
        })
        const hash = await hashPassword(parsed.data.password)
        await setPasswordHash(parsed.data.userId, hash)
        await addMember({
          wsId: params.id,
          userId: parsed.data.userId,
          role: parsed.data.role,
          addedBy: guard.value.user.id,
        })

        await appendAuditEvent(
          { type: 'workspace', wsId: params.id },
          {
            type: 'member_created_directly',
            userId: parsed.data.userId,
            role: parsed.data.role,
            actorUserId: guard.value.user.id,
            hadEmail: !!parsed.data.email,
          },
        )

        return json({
          ok: true,
          userId: parsed.data.userId,
          name: parsed.data.name,
          role: parsed.data.role,
        })
      },
    },
  },
})
