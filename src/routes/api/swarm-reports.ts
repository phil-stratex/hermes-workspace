import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { listSwarmReports } from '../../server/swarm-missions'

export const Route = createFileRoute('/api/swarm-reports')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response
        const url = new URL(request.url)
        const missionId = url.searchParams.get('missionId')?.trim() || null
        const workerId = url.searchParams.get('workerId')?.trim() || null
        const limitRaw = Number(url.searchParams.get('limit') ?? 100)
        const limit = Number.isFinite(limitRaw) ? limitRaw : 100
        return json({
          ok: true,
          fetchedAt: Date.now(),
          missionId,
          workerId,
          reports: listSwarmReports({ missionId, workerId, limit }),
        })
      },
    },
  },
})
