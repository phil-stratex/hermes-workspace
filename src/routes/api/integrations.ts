import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import {
  detectByteroverIntegration,
  detectHonchoIntegration,
} from '../../server/integration-detection'

export const Route = createFileRoute('/api/integrations')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response

        return json({
          ok: true,
          checkedAt: Date.now(),
          integrations: {
            honcho: detectHonchoIntegration(),
            byterover: detectByteroverIntegration(),
          },
        })
      },
    },
  },
})
