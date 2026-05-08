/**
 * POST /api/test-error?type=fatal|error|warn
 *
 * Manual smoke-test trigger. Records a marked entry with `source:'test'`
 * so the operator can verify the Live-Tail UI without waiting for a
 * real Hermes failure. Default-filtered out of the `/errors` list view
 * (toggle "Test-Errors zeigen" to see them).
 *
 * Hardening:
 *   1. Disabled in production unless `HERMES_ENABLE_TEST_ERROR_ENDPOINT=1`
 *   2. `requireStackAdmin` gate even in dev — defense-in-depth against
 *      a leaked Vite-port being on a public network
 *   3. Per-user rate-limit (30/min token-bucket) so a curl-loop can't
 *      flood the JSONL with hundreds of fake entries
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { requireStackAdmin } from '../../server/error-acl'
import { appendErrorEntry } from '../../server/error-store'
import type { Severity } from '../../server/error-types'

const ENABLED =
  process.env.NODE_ENV !== 'production' ||
  process.env.HERMES_ENABLE_TEST_ERROR_ENDPOINT === '1'

const RATE_WINDOW_MS = 60_000
const RATE_MAX = 30
const buckets = new Map<string, Array<number>>()

function rateAllow(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now()
  const arr = buckets.get(key) ?? []
  const fresh = arr.filter((t) => now - t < RATE_WINDOW_MS)
  if (fresh.length >= RATE_MAX) {
    const oldest = fresh[0]
    const retryAfterSec = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - oldest)) / 1000))
    buckets.set(key, fresh)
    return { ok: false, retryAfterSec }
  }
  fresh.push(now)
  buckets.set(key, fresh)
  return { ok: true }
}

const VALID_TYPES: ReadonlyArray<Severity> = ['fatal', 'error', 'warn', 'info']

export const Route = createFileRoute('/api/test-error')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!ENABLED) {
          return json({ ok: false, error: 'Not Found' }, { status: 404 })
        }
        const guard = requireStackAdmin(request)
        if (!guard.ok) return guard.response

        const userKey = guard.value.user?.id ?? 'legacy-pw'
        const allow = rateAllow(userKey)
        if (!allow.ok) {
          return new Response(
            JSON.stringify({ ok: false, error: 'rate-limited', retryAfter: allow.retryAfterSec }),
            {
              status: 429,
              headers: {
                'Content-Type': 'application/json',
                'Retry-After': String(allow.retryAfterSec),
              },
            },
          )
        }

        const url = new URL(request.url)
        const typeParam = url.searchParams.get('type') as Severity | null
        const level: Severity = typeParam && VALID_TYPES.includes(typeParam) ? typeParam : 'error'

        const entry = await appendErrorEntry({
          source: 'test',
          level,
          message: `Test error triggered by ${userKey}`,
          // No real stack — marker entries should be visually identifiable.
          context: {
            triggeredAt: Date.now(),
            triggeredBy: userKey,
          },
        })

        return json({
          ok: true,
          id: entry.id,
          note: 'Default-filtered in /errors view; toggle "Test-Errors zeigen" to inspect.',
        })
      },
    },
  },
})
