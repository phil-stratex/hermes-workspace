import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../server/route-auth-helpers'
import { createFileRoute } from '@tanstack/react-router'
// (auth-middleware import dropped — uses route-auth-helpers below)
import {
  ensureDiscovery,
  forceDiscovery,
  getDiscoveryStatus,
  getDiscoveredModels,
  isProviderConfigured,
} from '../../server/local-provider-discovery'

export const Route = createFileRoute('/api/local-providers')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response

        const url = new URL(request.url)
        const refresh = url.searchParams.get('refresh') === 'true'

        if (refresh) {
          await forceDiscovery()
        } else {
          await ensureDiscovery()
        }

        const status = getDiscoveryStatus()
        const models = getDiscoveredModels()

        return json({
          ok: true,
          providers: status.map((p) => ({
            ...p,
            configured: isProviderConfigured(p.id),
            needsRestart: isProviderConfigured(p.id) ? false : p.online,
          })),
          models,
          totalLocalModels: models.length,
        })
      },
    },
  },
})
