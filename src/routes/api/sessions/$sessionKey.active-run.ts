import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { getActiveRunForSession } from '../../../server/run-store'

export const Route = createFileRoute('/api/sessions/$sessionKey/active-run')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response

        const sessionKey = params.sessionKey?.trim()
        if (!sessionKey) {
          return json(
            { ok: false, error: 'sessionKey required' },
            { status: 400 },
          )
        }

        try {
          const run = await getActiveRunForSession(sessionKey)
          return json({ ok: true, run })
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
