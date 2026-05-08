/**
 * GET /api/errors
 *
 * Paginated list of recorded errors. Stack-Admin-only via
 * `requireStackAdmin` (auto-detect: any authenticated user pre-multi-
 * tenant migration; only `stackAdmins[]` post-migration).
 *
 * Filters via query params:
 *   since=<iso>          inclusive lower bound on entry.ts
 *   level=<csv>          fatal,error,warn,info,debug
 *   source=<csv>         backend,frontend,gateway,...
 *   userId=<slug>
 *   workspaceId=<slug>
 *   search=<substr>      case-insensitive against message+route
 *   limit=<int>          default 100, max 1000
 *   offset=<int>         default 0
 *   includeTest=1        opt-in to source:test entries (default hidden)
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { requireStackAdmin } from '../../server/error-acl'
import { listErrors } from '../../server/error-store'
import type { ListFilter } from '../../server/error-store'
import type { Severity } from '../../server/error-types'

const VALID_LEVELS: ReadonlyArray<Severity> = ['fatal', 'error', 'warn', 'info', 'debug']

function parseCsvLevel(s: string | null): Array<Severity> | undefined {
  if (!s) return undefined
  const out = s
    .split(',')
    .map((p) => p.trim())
    .filter((p) => VALID_LEVELS.includes(p as Severity)) as Array<Severity>
  return out.length > 0 ? out : undefined
}

function parseCsvSource(s: string | null): Array<string> | undefined {
  if (!s) return undefined
  const out = s
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  return out.length > 0 ? out : undefined
}

function parseInt32(s: string | null, fallback: number, max: number): number {
  if (!s) return fallback
  const n = Number.parseInt(s, 10)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(n, max)
}

export const Route = createFileRoute('/api/errors')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = requireStackAdmin(request)
        if (!guard.ok) return guard.response

        const url = new URL(request.url)
        const filter: ListFilter = {
          since: url.searchParams.get('since') ?? undefined,
          level: parseCsvLevel(url.searchParams.get('level')),
          source: parseCsvSource(url.searchParams.get('source')),
          userId: url.searchParams.get('userId') ?? undefined,
          workspaceId: url.searchParams.get('workspaceId') ?? undefined,
          search: url.searchParams.get('search') ?? undefined,
          limit: parseInt32(url.searchParams.get('limit'), 100, 1000),
          offset: parseInt32(url.searchParams.get('offset'), 0, 100_000),
          includeTest: url.searchParams.get('includeTest') === '1',
        }
        const result = listErrors(filter)
        return json({ ok: true, ...result })
      },
    },
  },
})
