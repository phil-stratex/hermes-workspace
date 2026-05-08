import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'

import {
  createSessionCookie,
  getCurrentUser,
  getRequestIp,
  isMultiTenantAuthEnabled,
  issueUserSessionToken,
  revokeAllUserSessionTokens,
} from '../../server/auth-middleware'
import { hashPassword, verifyPassword } from '../../server/auth-passwords'
import { appendAuditEvent } from '../../server/audit-log'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'
import { getPasswordHash, setPasswordHash, updateUserProfile } from '../../server/users-store'

const ChangeSchema = z.object({
  oldPassword: z.string().min(1).max(1000),
  newPassword: z.string().min(8).max(1000),
})

export const Route = createFileRoute('/api/auth/change-password')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isMultiTenantAuthEnabled()) {
          return json({ ok: false, error: 'multi-tenant auth not enabled' }, { status: 412 })
        }
        const user = getCurrentUser(request)
        if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })

        const ip = getClientIp(request)
        if (!rateLimit(`auth:change:${user.id}:${ip}`, 5, 60_000)) return rateLimitResponse()

        const raw = await request.json().catch(() => ({}))
        const parsed = ChangeSchema.safeParse(raw)
        if (!parsed.success) {
          return json({ ok: false, error: 'Invalid request' }, { status: 400 })
        }

        const stored = getPasswordHash(user.id)
        const valid = stored ? await verifyPassword(parsed.data.oldPassword, stored) : false
        if (!valid) {
          return json({ ok: false, error: 'Old password incorrect' }, { status: 401 })
        }

        const newHash = await hashPassword(parsed.data.newPassword)
        await setPasswordHash(user.id, newHash)

        // Clear mustChangePassword + invalidate all OTHER sessions; issue a fresh
        // token for the current request so the user stays signed in.
        await updateUserProfile(user.id, (p) =>
          p ? { ...p, mustChangePassword: false } : null,
        )
        await revokeAllUserSessionTokens(user.id)
        const newToken = await issueUserSessionToken({
          userId: user.id,
          ip: getRequestIp(request),
          userAgent: request.headers.get('user-agent') ?? undefined,
        })

        await appendAuditEvent('global', {
          type: 'password_changed',
          userId: user.id,
          ip: getRequestIp(request),
        })

        return json(
          { ok: true },
          { status: 200, headers: { 'Set-Cookie': createSessionCookie(newToken) } },
        )
      },
    },
  },
})
