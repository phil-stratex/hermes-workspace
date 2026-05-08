import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import {
  BEARER_TOKEN,
  CLAUDE_API,
  dashboardFetch,
  ensureGatewayProbed,
} from '../../../server/gateway-capabilities'

function authHeaders(): Record<string, string> {
  return BEARER_TOKEN ? { Authorization: `Bearer ${BEARER_TOKEN}` } : {}
}

export const Route = createFileRoute('/api/skills/toggle')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response
        try {
          const body = (await request.json()) as {
            skillId?: string
            name?: string
            enabled?: boolean
          }
          const name = (body.name || body.skillId || '').trim()
          if (!name) {
            return json(
              { ok: false, error: 'name or skillId required' },
              { status: 400 },
            )
          }
          if (typeof body.enabled !== 'boolean') {
            return json(
              { ok: false, error: 'enabled (boolean) required' },
              { status: 400 },
            )
          }

          const capabilities = await ensureGatewayProbed()
          const response = capabilities.dashboard.available
            ? await dashboardFetch('/api/skills/toggle', {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  name,
                  enabled: body.enabled,
                }),
                signal: AbortSignal.timeout(15_000),
              })
            : await fetch(`${CLAUDE_API}/api/skills/toggle`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...authHeaders(),
                },
                body: JSON.stringify({
                  name,
                  enabled: body.enabled,
                }),
                signal: AbortSignal.timeout(15_000),
              })

          const result = await response.json()
          return json(result, { status: response.status })
        } catch (error) {
          return json(
            {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to toggle skill',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
