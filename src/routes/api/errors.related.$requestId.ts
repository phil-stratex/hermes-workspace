/**
 * GET /api/errors/related/$requestId
 *
 * Returns all entries within ±5 s of the first hit for `requestId`.
 * Used by the detail-view to render a per-request timeline that pulls
 * in non-error info-level entries from the same handler invocation.
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { requireStackAdmin } from '../../server/error-acl'
import { findRelatedByRequestId } from '../../server/error-store'

export const Route = createFileRoute('/api/errors/related/$requestId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const guard = requireStackAdmin(request)
        if (!guard.ok) return guard.response

        const url = new URL(request.url)
        const windowParam = url.searchParams.get('windowMs')
        const windowMs = windowParam ? Number.parseInt(windowParam, 10) : 5000
        const resolved =
          Number.isFinite(windowMs) && windowMs > 0 && windowMs <= 60 * 60 * 1000
            ? windowMs
            : 5000

        const related = findRelatedByRequestId(params.requestId, resolved)
        return json({ ok: true, requestId: params.requestId, windowMs: resolved, related })
      },
    },
  },
})
