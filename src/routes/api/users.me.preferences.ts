/**
 * GET / PATCH /api/users/me/preferences
 *
 * Per-user UI preferences. Multi-tenant only — pre-migration there's
 * no user identity, so the route surfaces 404 in legacy mode rather
 * than silently writing to a phantom userId.
 *
 * GET   → current `UserPreferences`
 * PATCH → shallow merge of `{ lastErrorSeenAt?, ui? }` into the file
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { isMultiTenantAuthEnabled, requireUser } from '../../server/auth-middleware'
import { getUserPreferences, updateUserPreferences } from '../../server/user-preferences'
import { requireJsonContentType } from '../../server/rate-limit'

function legacyNotFound(): Response {
  return json(
    { ok: false, error: 'Not Found', reason: 'preferences require multi-tenant auth' },
    { status: 404 },
  )
}

export const Route = createFileRoute('/api/users/me/preferences')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isMultiTenantAuthEnabled()) return legacyNotFound()
        const auth = requireUser(request)
        if (!auth.ok) return auth.response
        const prefs = getUserPreferences(auth.value.id)
        return json({ ok: true, preferences: prefs })
      },
      PATCH: async ({ request }) => {
        if (!isMultiTenantAuthEnabled()) return legacyNotFound()
        const auth = requireUser(request)
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
        const patch: { lastErrorSeenAt?: string; ui?: Record<string, unknown> } = {}
        if (typeof obj.lastErrorSeenAt === 'string') {
          // Validate ISO format — Date.parse handles most of the input
          // surface; reject anything that wouldn't round-trip.
          const ts = Date.parse(obj.lastErrorSeenAt)
          if (Number.isFinite(ts)) {
            patch.lastErrorSeenAt = new Date(ts).toISOString()
          }
        }
        if (obj.ui && typeof obj.ui === 'object') {
          patch.ui = obj.ui as Record<string, unknown>
        }
        const next = await updateUserPreferences(auth.value.id, patch)
        return json({ ok: true, preferences: next })
      },
    },
  },
})
