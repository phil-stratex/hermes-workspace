import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { listFileArtifacts } from '../../server/file-artifact-store'

export const Route = createFileRoute('/api/file-artifacts')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const sessionId = url.searchParams.get('sessionId')?.trim() || undefined
        const path = url.searchParams.get('path')?.trim() || undefined
        const limit = Number(url.searchParams.get('limit') || '100')
        const artifacts = listFileArtifacts({ sessionId, path }).slice(
          0,
          Number.isFinite(limit) && limit > 0 ? limit : 100,
        )
        return json({ ok: true, artifacts })
      },
    },
  },
})
