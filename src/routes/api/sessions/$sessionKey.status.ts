import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  ensureGatewayProbed,
  getGatewayCapabilities,
  getSession,
  toSessionSummary,
} from '../../../server/claude-api'

export const Route = createFileRoute('/api/sessions/$sessionKey/status')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response
        await ensureGatewayProbed()
        if (!getGatewayCapabilities().sessions) {
          return json(
            { ok: false, error: SESSIONS_API_UNAVAILABLE_MESSAGE },
            { status: 503 },
          )
        }

        const { sessionKey } = params

        if (!sessionKey || sessionKey.trim().length === 0) {
          return json(
            { ok: false, error: 'sessionKey required' },
            { status: 400 },
          )
        }

        try {
          const session = await getSession(sessionKey)
          const result = toSessionSummary(session)
          return json({
            ok: true,
            status: result.status ?? 'idle',
            ...result,
          })
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
