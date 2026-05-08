/**
 * GET /api/errors/$id
 *
 * Single-entry detail — also returns related-logs (same requestId,
 * ±5s window) so the UI can render the timeline tab in one round-trip.
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { requireStackAdmin } from '../../server/error-acl'
import { findRelatedByRequestId, getErrorById } from '../../server/error-store'

export const Route = createFileRoute('/api/errors/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const guard = requireStackAdmin(request)
        if (!guard.ok) return guard.response

        const entry = getErrorById(params.id)
        if (!entry) {
          return json({ ok: false, error: 'Not Found' }, { status: 404 })
        }
        const related = entry.requestId ? findRelatedByRequestId(entry.requestId) : []
        return json({ ok: true, entry, related })
      },
    },
  },
})
