import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireActiveWorkspaceMember, requireWorkspaceAction } from '../../server/route-auth-helpers'
import { requireJsonContentType } from '../../server/rate-limit'
import {
  SWARM_ROSTER_PATH,
  readSwarmRoster,
  upsertSwarmRosterWorker,
  patchSwarmRosterWorker,
} from '../../server/swarm-roster'
import { listSwarmWorkerIds } from '../../server/swarm-foundation'

export const Route = createFileRoute('/api/swarm-roster')({
  server: {
    handlers: {
      // GET — every active-workspace member can read the roster.
      GET: async ({ request }) => {
        const auth = requireActiveWorkspaceMember(request)
        if (!auth.ok) return auth.response
        const ids = listSwarmWorkerIds()
        return json({
          ok: true,
          path: SWARM_ROSTER_PATH,
          roster: readSwarmRoster(ids),
          fetchedAt: Date.now(),
        })
      },
      // POST — full upsert is `roster-edit` (admin/owner only in MT).
      POST: async ({ request }) => {
        const guard = requireWorkspaceAction(request, 'roster-edit')
        if (!guard.ok) return guard.response
        const csrfCheckPost = requireJsonContentType(request)
        if (csrfCheckPost) return csrfCheckPost
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
        }
        try {
          const ids = listSwarmWorkerIds()
          const roster = upsertSwarmRosterWorker(body as never, ids)
          return json({ ok: true, path: SWARM_ROSTER_PATH, roster, savedAt: Date.now() })
        } catch (error) {
          return json({
            ok: false,
            error: error instanceof Error ? error.message : 'Failed to save swarm roster entry',
          }, { status: 400 })
        }
      },
      // PATCH — partial update is also `roster-edit`.
      PATCH: async ({ request }) => {
        const guard = requireWorkspaceAction(request, 'roster-edit')
        if (!guard.ok) return guard.response
        const csrfCheckPatch = requireJsonContentType(request)
        if (csrfCheckPatch) return csrfCheckPatch
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
        }
        try {
          const ids = listSwarmWorkerIds()
          const roster = patchSwarmRosterWorker(body as never, ids)
          return json({ ok: true, path: SWARM_ROSTER_PATH, roster, savedAt: Date.now() })
        } catch (error) {
          return json({
            ok: false,
            error: error instanceof Error ? error.message : 'Failed to patch swarm roster entry',
          }, { status: 400 })
        }
      },
    },
  },
})
