import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  ensureGatewayProbed,
  getGatewayCapabilities,
} from '../../server/claude-api'
import { requireJsonContentType } from '../../server/rate-limit'

export const Route = createFileRoute('/api/send')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        await ensureGatewayProbed()
        if (!getGatewayCapabilities().sessions) {
          return json(
            { ok: false, error: SESSIONS_API_UNAVAILABLE_MESSAGE },
            { status: 503 },
          )
        }
        return json(
          {
            ok: false,
            error: 'Legacy send is not available in Hermes Workspace.',
          },
          { status: 501 },
        )
      },
    },
  },
})
