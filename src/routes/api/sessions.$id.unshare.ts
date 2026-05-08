import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { getActiveWorkspace, requirePermission, requireUser } from '../../server/auth-middleware'
import { appendAuditEvent } from '../../server/audit-log'
import { requireJsonContentType } from '../../server/rate-limit'
import { readSessionsMeta, unshareSession } from '../../server/sessions-privacy'

/**
 * POST /api/sessions/$id/unshare — flip a session back to user-private.
 *
 * Only the original owner OR an admin can un-share. Snapshot file is
 * left on disk for one cleanup cycle (so a viewer with the URL open
 * gets an empty mapping but doesn't crash); the next workspace
 * member-removal sweep will delete it.
 */
export const Route = createFileRoute('/api/sessions/$id/unshare')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        const auth = requireUser(request)
        if (!auth.ok) return auth.response
        const wsId = getActiveWorkspace(request)
        if (!wsId) {
          return json({ ok: false, error: 'No active workspace' }, { status: 400 })
        }
        const guard = requirePermission(request, wsId, 'session-share')
        if (!guard.ok) return guard.response

        const meta = readSessionsMeta(wsId)
        const entry = meta.sessions[params.id]
        if (!entry) {
          return json({ ok: false, error: 'Session not found' }, { status: 404 })
        }
        if (!entry.shared) {
          return json({ ok: true, sessionId: params.id, shared: false })
        }
        if (entry.ownerId !== auth.value.id) {
          const adminGuard = requirePermission(request, wsId, 'members-manage')
          if (!adminGuard.ok) {
            return json({ ok: false, error: 'Forbidden', reason: 'not-session-owner' }, { status: 403 })
          }
        }

        await unshareSession({ wsId, sessionId: params.id })
        await appendAuditEvent(
          { type: 'workspace', wsId },
          {
            type: 'session_unshared',
            sessionId: params.id,
            actorUserId: auth.value.id,
          },
        )
        return json({ ok: true, sessionId: params.id, shared: false })
      },
    },
  },
})
