/**
 * GET /api/errors/stream  (text/event-stream)
 *
 * Live tail of the error-log. Stack-Admin-only via `requireStackAdmin`.
 *
 * - Heartbeat comment every 30 s so reverse-proxies don't drop the
 *   socket (Cloudflare/Tunnel + nginx default idle is 60s).
 * - Auto-disconnect after 30 min idle (no events, just heartbeats).
 * - Filter via `?level=error,fatal&source=backend,frontend` so a Bell
 *   subscriber only wakes for the entries it cares about.
 *
 * Pattern follows `routes/api/council.ts:288-334` (start+cancel pair,
 * encoder.encode, controller.enqueue).
 */

import { createFileRoute } from '@tanstack/react-router'

import { requireStackAdmin } from '../../server/error-acl'
import { subscribeToErrorEntries } from '../../server/error-events'
import type { ErrorEntry, Severity } from '../../server/error-types'

const HEARTBEAT_MS = 30_000
const MAX_IDLE_MS = 30 * 60 * 1000

const VALID_LEVELS: ReadonlyArray<Severity> = ['fatal', 'error', 'warn', 'info', 'debug']

function parseCsv(s: string | null, allowed?: ReadonlyArray<string>): Array<string> {
  if (!s) return []
  return s
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && (allowed === undefined || allowed.includes(p)))
}

export const Route = createFileRoute('/api/errors/stream')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = requireStackAdmin(request)
        if (!guard.ok) return guard.response

        const url = new URL(request.url)
        const levelFilter = parseCsv(url.searchParams.get('level'), VALID_LEVELS)
        const sourceFilter = parseCsv(url.searchParams.get('source'))
        const includeTest = url.searchParams.get('includeTest') === '1'

        const passes = (e: ErrorEntry): boolean => {
          if (levelFilter.length > 0 && !levelFilter.includes(e.level)) return false
          if (sourceFilter.length > 0 && !sourceFilter.includes(e.source)) return false
          if (!includeTest && e.source === 'test') return false
          return true
        }

        const encoder = new TextEncoder()
        let unsubscribe: (() => void) | null = null
        let heartbeat: ReturnType<typeof setInterval> | null = null
        let idleTimer: ReturnType<typeof setTimeout> | null = null
        let closed = false

        const stream = new ReadableStream({
          start(controller) {
            const sendEvent = (event: string, data: unknown) => {
              if (closed) return
              const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
              try {
                controller.enqueue(encoder.encode(payload))
              } catch {
                closed = true
              }
            }
            const sendHeartbeat = () => {
              if (closed) return
              try {
                controller.enqueue(encoder.encode(':hb\n\n'))
              } catch {
                closed = true
              }
            }
            const resetIdle = () => {
              if (idleTimer) clearTimeout(idleTimer)
              idleTimer = setTimeout(() => {
                sendEvent('disconnect', { reason: 'idle-30min' })
                closed = true
                try {
                  controller.close()
                } catch {
                  // already closed
                }
              }, MAX_IDLE_MS)
            }

            sendEvent('hello', { ts: new Date().toISOString() })
            heartbeat = setInterval(sendHeartbeat, HEARTBEAT_MS)
            resetIdle()

            unsubscribe = subscribeToErrorEntries((entry) => {
              if (!passes(entry)) return
              sendEvent('error', entry)
              resetIdle()
            })
          },
          cancel() {
            closed = true
            if (unsubscribe) unsubscribe()
            if (heartbeat) clearInterval(heartbeat)
            if (idleTimer) clearTimeout(idleTimer)
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        })
      },
    },
  },
})
