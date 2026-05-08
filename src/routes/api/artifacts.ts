import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { listToolArtifacts } from '../../server/tool-artifacts-store'

export const Route = createFileRoute('/api/artifacts')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response

        const url = new URL(request.url)
        const sessionId = url.searchParams.get('sessionId')?.trim() || undefined
        const limit = Number(url.searchParams.get('limit') || '100')
        const artifacts = listToolArtifacts(sessionId).slice(
          0,
          Number.isFinite(limit) && limit > 0 ? limit : 100,
        )
        return json({ ok: true, artifacts })
      },
    },
  },
})
