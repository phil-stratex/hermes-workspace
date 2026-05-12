import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireActiveWorkspaceMember } from '../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { getSwarmMission, listSwarmMissions, listSwarmReports, SWARM_MISSIONS_PATH } from '../../server/swarm-missions'
import { isLegacyDataWorkspace } from '../../server/workspace-data-scope'

export const Route = createFileRoute('/api/swarm-missions')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireActiveWorkspaceMember(request)
        if (!auth.ok) return auth.response
        // Swarm missions live in the repo-rooted `.runtime/swarm-missions.json`
        // — only the migration-default workspace owns them.
        if (!isLegacyDataWorkspace(auth.value.wsId)) {
          return json({
            ok: true,
            path: null,
            mission: null,
            missions: [],
            reports: [],
            fetchedAt: Date.now(),
            reason: 'workspace has no local missions yet',
          })
        }
        const url = new URL(request.url)
        const id = url.searchParams.get('id')?.trim()
        const limitRaw = Number(url.searchParams.get('limit') ?? 20)
        const limit = Number.isFinite(limitRaw) ? limitRaw : 20
        return json({
          ok: true,
          path: SWARM_MISSIONS_PATH,
          mission: id ? getSwarmMission(id) : null,
          missions: id ? [] : listSwarmMissions(limit),
          reports: id ? listSwarmReports({ missionId: id, limit }) : [],
          fetchedAt: Date.now(),
        })
      },
    },
  },
})
