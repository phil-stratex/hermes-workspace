import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import {
  getActiveWorkspace,
  isMultiTenantAuthEnabled,
  requireUser,
} from '../../server/auth-middleware'
import { readSessionsMeta } from '../../server/sessions-privacy'

/**
 * GET /api/sessions/$id/meta
 *
 * Returns just the workspace-mapping info for a single session — used
 * by the chat surface to decide whether to render the read-only
 * banner for non-owner viewers (Plan F11). Returns
 * `{ tagged: false }` for untagged sessions; `{ tagged: true, ... }`
 * with the relevant fields otherwise.
 *
 * Returns null on legacy stacks so the chat UI can no-op.
 */
export const Route = createFileRoute('/api/sessions/$id/meta')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isMultiTenantAuthEnabled()) {
          return json({ ok: true, multiTenant: false })
        }
        const auth = requireUser(request)
        if (!auth.ok) return auth.response
        const wsId = getActiveWorkspace(request)
        if (!wsId) {
          return json({ ok: true, multiTenant: true, tagged: false })
        }
        const meta = readSessionsMeta(wsId)
        const entry = meta.sessions[params.id]
        if (!entry) {
          return json({ ok: true, multiTenant: true, tagged: false })
        }
        return json({
          ok: true,
          multiTenant: true,
          tagged: true,
          sessionId: params.id,
          ownerId: entry.ownerId,
          shared: entry.shared,
          sharedBy: entry.sharedBy,
          sharedAt: entry.sharedAt,
          /** Convenience for the UI — caller is the original owner */
          isOwner: entry.ownerId === auth.value.id,
        })
      },
    },
  },
})
