import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import {
  clearSessionCookie,
  getCurrentUser,
  getSessionTokenFromCookie,
  isMultiTenantAuthEnabled,
  revokeSessionToken,
  revokeUserSessionToken,
} from '../../server/auth-middleware'
import { appendAuditEvent } from '../../server/audit-log'
import { requireJsonContentType } from '../../server/rate-limit'

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const token = getSessionTokenFromCookie(request.headers.get('cookie'))

        if (isMultiTenantAuthEnabled()) {
          const user = getCurrentUser(request)
          if (token) await revokeUserSessionToken(token)
          if (user) {
            await appendAuditEvent('global', { type: 'logout', userId: user.id })
          }
        } else if (token) {
          revokeSessionToken(token)
        }

        return json(
          { ok: true },
          { status: 200, headers: { 'Set-Cookie': clearSessionCookie() } },
        )
      },
    },
  },
})
