import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../../server/route-auth-helpers'
import {
  deriveFallbackModelInfoFromGateway,
  normalizeModelInfoResponse,
} from '@/lib/model-info'
// (auth-middleware import dropped — uses route-auth-helpers below)
import {
  dashboardFetch,
  ensureGatewayProbed,
  getCapabilities,
  getGatewayMode,
} from '../../../server/gateway-capabilities'

export const Route = createFileRoute('/api/model/info')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response

        await ensureGatewayProbed()
        const gatewayMode = getGatewayMode()

        let rawPayload: unknown = null
        try {
          const response = await dashboardFetch('/api/model/info')
          if (response.ok) {
            rawPayload = await response.json()
          }
        } catch {
          rawPayload = null
        }

        const normalized = normalizeModelInfoResponse(rawPayload)
        const shouldUseFallback =
          normalized.supportsRuntimeSwitching === null &&
          normalized.vanillaAgent === null
        const resolved = shouldUseFallback
          ? deriveFallbackModelInfoFromGateway(gatewayMode, getCapabilities())
          : normalized

        if (shouldUseFallback) {
          console.log(
            `[model-info] falling back to gateway capabilities (source=gateway-capabilities mode=${gatewayMode})`,
          )
        }

        return json({
          ...resolved,
          gatewayMode,
        })
      },
    },
  },
})
