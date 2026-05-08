import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'

import {
  createSessionCookie,
  getRequestIp,
  isMultiTenantAuthEnabled,
  issueUserSessionToken,
} from '../../server/auth-middleware'
import { hashPassword } from '../../server/auth-passwords'
import { appendAuditEvent } from '../../server/audit-log'
import { isValidSlug } from '../../server/data-paths'
import { consumeInvite, getInvite, isInviteValid } from '../../server/invites-store'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'
import { createUser, getUserProfile, listUsers, setPasswordHash, updateUserProfile } from '../../server/users-store'
import { addMember, getMember, getWorkspaceMeta, isWorkspaceActive } from '../../server/workspace-store'

const AcceptSchema = z.object({
  userId: z.string(),
  name: z.string().min(1).max(200),
  password: z.string().min(8).max(1000),
})

export const Route = createFileRoute('/api/invites/$token/accept')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isMultiTenantAuthEnabled()) {
          return json({ ok: false, error: 'multi-tenant auth not enabled' }, { status: 412 })
        }
        const ip = getClientIp(request)
        if (!rateLimit(`invite:accept:${ip}`, 5, 60_000)) return rateLimitResponse()

        const raw = await request.json().catch(() => ({}))
        const parsed = AcceptSchema.safeParse(raw)
        if (!parsed.success) {
          return json({ ok: false, error: 'Invalid request' }, { status: 400 })
        }
        if (!isValidSlug(parsed.data.userId)) {
          return json({ ok: false, error: 'Invalid userId (slug expected)' }, { status: 400 })
        }

        const invite = getInvite(params.token)
        if (!invite || !isInviteValid(invite)) {
          return json({ ok: false, error: 'Invite invalid or expired' }, { status: 410 })
        }
        const ws = getWorkspaceMeta(invite.workspaceId)
        if (!isWorkspaceActive(ws)) {
          return json({ ok: false, error: 'Workspace unavailable' }, { status: 410 })
        }

        // If a user with the chosen id already exists, refuse — invite-accept
        // creates a new user; existing users sign in via /api/auth/login first
        // and then the admin adds them via /api/workspaces/$id/members.
        const userId = parsed.data.userId
        if (listUsers().includes(userId) || getUserProfile(userId)) {
          return json({ ok: false, error: 'User id already taken' }, { status: 409 })
        }
        // Already a member? Shouldn't happen via this flow; treat as conflict.
        if (getMember(invite.workspaceId, userId)) {
          return json({ ok: false, error: 'Already a member of this workspace' }, { status: 409 })
        }

        // Atomically: consume invite → create user → add member → audit → login.
        await consumeInvite(params.token, userId)
        await createUser({
          id: userId,
          email: invite.email ?? `${userId}@local`,
          name: parsed.data.name,
          status: 'active',
          mustChangePassword: false,
          defaultWorkspaceId: invite.workspaceId,
        })
        const hash = await hashPassword(parsed.data.password)
        await setPasswordHash(userId, hash)
        await addMember({
          wsId: invite.workspaceId,
          userId,
          role: invite.role,
          addedBy: invite.invitedBy,
        })
        await updateUserProfile(userId, (p) =>
          p ? { ...p, defaultWorkspaceId: invite.workspaceId } : null,
        )

        await appendAuditEvent(
          { type: 'workspace', wsId: invite.workspaceId },
          {
            type: 'member_added_via_invite',
            userId,
            role: invite.role,
            invitedBy: invite.invitedBy,
            inviteToken: params.token,
          },
        )

        const token = await issueUserSessionToken({
          userId,
          ip: getRequestIp(request),
          userAgent: request.headers.get('user-agent') ?? undefined,
        })
        return json(
          { ok: true, userId, workspaceId: invite.workspaceId },
          { status: 200, headers: { 'Set-Cookie': createSessionCookie(token) } },
        )
      },
    },
  },
})
