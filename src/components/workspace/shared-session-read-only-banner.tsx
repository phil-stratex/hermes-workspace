import { useEffect, useState } from 'react'

import { fetchCurrentUser } from '@/lib/workspace-auth'
import type { MeResponse } from '@/lib/workspace-auth'

type SessionMeta =
  | { ok: true; multiTenant: false }
  | { ok: true; multiTenant: true; tagged: false }
  | {
      ok: true
      multiTenant: true
      tagged: true
      sessionId: string
      ownerId: string
      shared: boolean
      sharedBy?: string
      sharedAt?: string
      isOwner: boolean
    }

/**
 * Read-only banner shown above a shared session for non-owner viewers.
 * Plan-Finding F11: shared sessions are read-only for everyone except
 * the original owner — the banner explains the state.
 *
 * Self-contained: reads `/api/sessions/$id/meta` and `/api/auth/me`.
 * Renders null in legacy mode, for the owner, and for unshared
 * sessions.
 */
export function SharedSessionReadOnlyBanner({ sessionId }: { sessionId: string }) {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [meta, setMeta] = useState<SessionMeta | null>(null)

  useEffect(() => {
    void fetchCurrentUser().then((res) => {
      if (res && 'mode' in res && res.mode === 'multi-tenant') {
        setMe(res as MeResponse)
      }
    })
  }, [])

  useEffect(() => {
    if (!me?.activeWorkspaceId || !sessionId) return
    void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/meta`, {
      credentials: 'same-origin',
    })
      .then((r) => r.json())
      .then((d: SessionMeta) => setMeta(d))
      .catch(() => setMeta(null))
  }, [me, sessionId])

  if (!me || !meta) return null
  if (!meta.multiTenant || !meta.tagged) return null
  if (!meta.shared) return null
  if (meta.isOwner) return null

  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800"
    >
      <span aria-hidden>👁</span>
      <span>
        Geteilt von <strong>{meta.sharedBy ?? meta.ownerId}</strong> — nur Lesezugriff. Nur der Owner kann hier weiterschreiben.
      </span>
    </div>
  )
}

/**
 * Returns true when the chat composer should be disabled for the
 * caller — used by `chat-screen` / `chat-composer` to gate the Send
 * button without shipping a 403 round-trip.
 */
export function useSharedSessionReadOnlyState(sessionId: string | null): {
  loading: boolean
  readOnly: boolean
} {
  const [loading, setLoading] = useState(true)
  const [readOnly, setReadOnly] = useState(false)

  useEffect(() => {
    if (!sessionId) {
      setLoading(false)
      setReadOnly(false)
      return
    }
    setLoading(true)
    void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/meta`, {
      credentials: 'same-origin',
    })
      .then((r) => r.json())
      .then((d: SessionMeta) => {
        if (d.ok && d.multiTenant && 'tagged' in d && d.tagged && d.shared && !d.isOwner) {
          setReadOnly(true)
        } else {
          setReadOnly(false)
        }
        setLoading(false)
      })
      .catch(() => {
        setReadOnly(false)
        setLoading(false)
      })
  }, [sessionId])

  return { loading, readOnly }
}
