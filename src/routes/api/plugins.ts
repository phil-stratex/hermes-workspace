import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { listWorkspacePlugins } from '../../server/plugins-browser'

export const Route = createFileRoute('/api/plugins')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response
        return json({ ok: true, plugins: listWorkspacePlugins() })
      },
    },
  },
})
