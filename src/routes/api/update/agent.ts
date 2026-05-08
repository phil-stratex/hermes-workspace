import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../../server/rate-limit'
import { applyAgentUpdate } from '../../../server/update-system'

export const Route = createFileRoute('/api/update/agent')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!rateLimit(`update-agent:${getClientIp(request)}`, 3, 60_000)) {
          return rateLimitResponse()
        }
        try {
          const result = applyAgentUpdate()
          return json(result, { status: result.ok ? 200 : 409 })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
