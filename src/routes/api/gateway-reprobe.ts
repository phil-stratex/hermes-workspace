/**
 * Force a fresh capability probe of the upstream gateway and dashboard.
 *
 * Useful when the workspace booted before the agent (Docker / docker
 * compose) and got cached as 'disconnected'. Without this, the UI is
 * stuck on the first failed probe for the full PROBE_TTL window. See
 * #275.
 *
 * POST  /api/gateway-reprobe   → returns the freshly-probed capabilities
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../server/route-auth-helpers'
import {
  CLAUDE_API,
  CLAUDE_DASHBOARD_URL,
  forceReprobeGateway,
  getGatewayMode,
} from '../../server/gateway-capabilities'
// (auth-middleware import dropped — uses route-auth-helpers below)

export const Route = createFileRoute('/api/gateway-reprobe')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response

        const capabilities = await forceReprobeGateway()
        return json({
          ok: true,
          capabilities,
          mode: getGatewayMode(),
          claudeUrl: CLAUDE_API,
          dashboardUrl: CLAUDE_DASHBOARD_URL,
          gateway: {
            available: capabilities.health || capabilities.chatCompletions,
            url: CLAUDE_API,
          },
          dashboard: capabilities.dashboard,
        })
      },
    },
  },
})
