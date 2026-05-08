import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'

import {
  createSessionCookie,
  getRequestIp,
  isMultiTenantAuthEnabled,
  loginWithEmailPassword,
} from '../../server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'

const LoginSchema = z.object({
  email: z.string().min(3).max(320),
  password: z.string().min(1).max(1000),
})

export const Route = createFileRoute('/api/auth/login')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        if (!isMultiTenantAuthEnabled()) {
          return json(
            {
              ok: false,
              error: 'multi-tenant auth not enabled',
              hint: 'Migration has not run. POST /api/auth (legacy single-PW) until the stack is migrated.',
            },
            { status: 412 },
          )
        }

        const ip = getClientIp(request)
        if (!rateLimit(`auth:login:${ip}`, 10, 60_000)) return rateLimitResponse()

        const raw = await request.json().catch(() => ({}))
        const parsed = LoginSchema.safeParse(raw)
        if (!parsed.success) {
          return json({ ok: false, error: 'Invalid request' }, { status: 400 })
        }

        const result = await loginWithEmailPassword(parsed.data.email, parsed.data.password, {
          ip: getRequestIp(request),
          userAgent: request.headers.get('user-agent') ?? undefined,
        })

        if (!result.ok) {
          // Constant-time-ish: small fixed delay regardless of reason so a
          // probe can't tell "no-such-user" apart from "invalid-credentials".
          await new Promise((r) => setTimeout(r, 250))
          const status =
            result.reason === 'locked' ? 423 :
            result.reason === 'disabled' ? 403 :
            401
          return json({ ok: false, error: 'Invalid credentials' }, { status })
        }

        return json(
          { ok: true, userId: result.userId },
          { status: 200, headers: { 'Set-Cookie': createSessionCookie(result.token) } },
        )
      },
    },
  },
})
