import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import {
  CLAUDE_API,
  CLAUDE_DASHBOARD_URL,
  ensureGatewayProbed,
  getCapabilities,
  getGatewayMode,
} from '../../server/gateway-capabilities'

export const Route = createFileRoute('/api/gateway-status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response

        const capabilities = await ensureGatewayProbed()
        return json({
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
