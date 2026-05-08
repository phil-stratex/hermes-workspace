import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { readContextUsage } from '@/server/context-usage'

export const Route = createFileRoute('/api/context-usage')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response

        const url = new URL(request.url)
        const sessionId = url.searchParams.get('sessionId')?.trim() || ''
        const snapshot = await readContextUsage(sessionId)
        return json(snapshot)
      },
    },
  },
})
