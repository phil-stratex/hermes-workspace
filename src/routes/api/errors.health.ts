/**
 * GET /api/errors/health
 *
 * Aggregate count-by-severity for the Health-Badge in the viewer
 * header. Default window is 1 hour; pass `?windowMs=86400000` for
 * 24 h-trend, etc. Also serves as the sidebar-visibility probe — a
 * 200 here means "render the /errors entry"; a 401/403 hides it.
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { requireStackAdmin } from '../../server/error-acl'
import { getHealthSummary } from '../../server/error-store'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function parseWindow(s: string | null): number {
  if (!s) return HOUR
  const n = Number.parseInt(s, 10)
  if (!Number.isFinite(n) || n < 60_000 || n > 7 * DAY) return HOUR
  return n
}

export const Route = createFileRoute('/api/errors/health')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = requireStackAdmin(request)
        if (!guard.ok) return guard.response

        const url = new URL(request.url)
        const windowMs = parseWindow(url.searchParams.get('windowMs'))
        const summary = getHealthSummary(windowMs)

        const fatalCount = summary.counts.fatal ?? 0
        const errorCount = summary.counts.error ?? 0
        let healthLevel: 'green' | 'yellow' | 'red' = 'green'
        if (fatalCount > 0 || errorCount > 20) healthLevel = 'red'
        else if (errorCount >= 5) healthLevel = 'yellow'

        return json({ ok: true, ...summary, health: healthLevel })
      },
    },
  },
})
