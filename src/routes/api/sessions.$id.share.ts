import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { getActiveWorkspace, requirePermission, requireUser } from '../../server/auth-middleware'
import { appendAuditEvent } from '../../server/audit-log'
import { listSessions } from '../../server/claude-api'
import { requireJsonContentType } from '../../server/rate-limit'
import {
  readSessionsMeta,
  shareSession,
  tagSession,
} from '../../server/sessions-privacy'
import { captureInitialSnapshot } from '../../server/sessions-snapshot'

/**
 * POST /api/sessions/$id/share — flip a session to workspace-shared.
 *
 * Allowed iff the caller is the owner of the session OR has
 * `members-manage` in the workspace (admins can share on behalf).
 * Captures an initial snapshot synchronously so non-owner viewers
 * see content right away.
 */
export const Route = createFileRoute('/api/sessions/$id/share')({
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

        // Ownership: caller must be the owner OR have members-manage.
        const meta = readSessionsMeta(wsId)
        const entry = meta.sessions[params.id]
        if (!entry) {
          // Untagged: tag to caller (assumes the route is hit by the owner).
          await tagSession(wsId, params.id, auth.value.id)
        } else if (entry.ownerId !== auth.value.id) {
          // Not owner — must be admin/owner in the workspace.
          const adminGuard = requirePermission(request, wsId, 'members-manage')
          if (!adminGuard.ok) {
            return json({ ok: false, error: 'Forbidden', reason: 'not-session-owner' }, { status: 403 })
          }
        }

        const updated = await shareSession({
          wsId,
          sessionId: params.id,
          sharedBy: auth.value.id,
        })

        // Capture an initial snapshot synchronously so non-owner views
        // don't have to wait for the first lazy refresh. Failure is
        // non-fatal — the session is shared, the snapshot will be
        // populated on the first viewer's read.
        try {
          await captureInitialSnapshot({
            wsId,
            sessionId: params.id,
            fetcher: async (sid) => {
              const items = await listSessions(50, 0)
              const found = items.find((s) => s.id === sid)
              return {
                payload: found ?? { id: sid, _note: 'gateway lookup returned nothing' },
                messageCount: found?.message_count ?? 0,
              }
            },
          })
        } catch (err) {
          console.warn(`[/api/sessions/${params.id}/share] initial snapshot failed`, err)
        }

        await appendAuditEvent(
          { type: 'workspace', wsId },
          {
            type: 'session_shared',
            sessionId: params.id,
            sharedBy: auth.value.id,
            ownerId: updated.ownerId,
          },
        )

        return json({ ok: true, sessionId: params.id, shared: true, sharedAt: updated.sharedAt })
      },
    },
  },
})
