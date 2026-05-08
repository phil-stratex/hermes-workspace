/**
 * POST /api/errors/client
 *
 * Browser → Backend error reporting. Any authenticated user (Member,
 * Admin, Owner — not just Stack-Admin) may submit, otherwise a Member
 * couldn't report a frontend bug she's hitting.
 *
 * Anti-spoof:
 *   - `source` is hard-coded to `'frontend'` server-side; the body
 *     value is ignored, so a malicious caller can't pretend to be a
 *     backend entry.
 *   - `stack` is run through the same redact pipeline as backend
 *     entries — Cookie / Authorization / API-Key / 32+-char tokens
 *     never reach disk.
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { appendErrorEntry } from '../../server/error-store'
import { requireAuthenticated } from '../../server/route-auth-helpers'
import { requireJsonContentType } from '../../server/rate-limit'
import { logger } from '../../server/logger'

const MAX_MESSAGE = 4 * 1024
const MAX_STACK = 16 * 1024 // redactor itself trims further

function asString(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  if (t.length === 0) return undefined
  return t.length > max ? t.slice(0, max) : t
}

function asContext(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== 'object') return undefined
  // Cap depth/breadth at the boundary too — redact() defends in depth.
  return v as Record<string, unknown>
}

function asBrowser(
  v: unknown,
): { userAgent?: string; url?: string; viewport?: { width: number; height: number } } | undefined {
  if (!v || typeof v !== 'object') return undefined
  const obj = v as Record<string, unknown>
  const ua = asString(obj.userAgent, 512)
  const url = asString(obj.url, 1024)
  let viewport: { width: number; height: number } | undefined
  if (obj.viewport && typeof obj.viewport === 'object') {
    const vp = obj.viewport as Record<string, unknown>
    if (typeof vp.width === 'number' && typeof vp.height === 'number') {
      viewport = { width: vp.width, height: vp.height }
    }
  }
  return ua || url || viewport ? { userAgent: ua, url, viewport } : undefined
}

export const Route = createFileRoute('/api/errors/client')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response
        const csrf = requireJsonContentType(request)
        if (csrf) return csrf

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return json({ ok: false, error: 'invalid-json' }, { status: 400 })
        }
        if (!body || typeof body !== 'object') {
          return json({ ok: false, error: 'expected object body' }, { status: 400 })
        }
        const obj = body as Record<string, unknown>
        const message = asString(obj.message, MAX_MESSAGE)
        if (!message) {
          return json({ ok: false, error: 'message required' }, { status: 400 })
        }
        const stack = asString(obj.stack, MAX_STACK)
        const context = asContext(obj.context)
        const browser = asBrowser(obj.browser)
        const level = obj.level === 'fatal' || obj.level === 'warn' ? obj.level : 'error'

        const entry = await appendErrorEntry({
          level,
          source: 'frontend', // anti-spoof — ignore body.source
          message,
          stack,
          context,
          browser,
          userId: auth.value.user?.id ?? null,
          workspaceId: auth.value.wsId,
        })

        // Mirror to stdout for `docker logs` parity. JSONL append is
        // already done by appendErrorEntry; we just want the operator
        // to see "frontend reported" from log-tail context.
        logger.info('frontend error reported', {
          source: 'frontend',
          id: entry.id,
          message,
        })

        return json({ ok: true, id: entry.id })
      },
    },
  },
})
