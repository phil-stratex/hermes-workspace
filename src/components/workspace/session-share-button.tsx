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
 * Toggle button for `POST /api/sessions/$id/{share,unshare}`.
 * Renders inline with the chat header. Reads `/api/sessions/$id/meta`
 * to derive the current shared state + ownership.
 *
 * Hidden when:
 *   - legacy mode (no multi-tenant auth)
 *   - the caller is not the session owner AND not an admin
 *     (server-side enforces this; we just hide the button visually
 *      to avoid a confusing 403)
 */
export function SessionShareButton({ sessionId }: { sessionId: string }) {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [meta, setMeta] = useState<SessionMeta | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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

  if (!me || !me.activeWorkspaceId) return null
  if (!meta) return null
  if (!meta.multiTenant) return null
  if (!meta.tagged) {
    // Untagged session — auto-tag happens on the next send-stream
    // call so we don't render the button until the mapping exists.
    return null
  }

  // Permission gate: only show to the owner OR an admin in the
  // active workspace.
  const activeMembership = me.memberships.find((m) => m.workspaceId === me.activeWorkspaceId)
  const canShare = meta.isOwner || activeMembership?.role === 'admin' || activeMembership?.role === 'owner'
  if (!canShare) return null

  async function toggle() {
    setBusy(true)
    setError('')
    try {
      const currentlyShared = meta && meta.multiTenant && meta.tagged && meta.shared
      const path = currentlyShared ? 'unshare' : 'share'
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/${path}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      )
      const body = await res.json() as { ok?: boolean; shared?: boolean; error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      // Refetch the meta so the UI reflects the post-toggle state.
      const refetch = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/meta`, {
        credentials: 'same-origin',
      })
      setMeta(await refetch.json() as SessionMeta)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktion fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  const isShared = meta.tagged && meta.shared

  return (
    <div className="inline-flex flex-col">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        title={
          isShared
            ? 'Mit dem Workspace geteilt — Klick zum Zurückprivatisieren'
            : 'Privat — Klick um mit dem Workspace zu teilen'
        }
        className={
          'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors '
          + (isShared
            ? 'bg-accent-500/10 text-accent-700 hover:bg-accent-500/20'
            : 'text-primary-600 hover:bg-primary-200')
          + (busy ? ' opacity-60' : '')
        }
      >
        <span aria-hidden>{isShared ? '👥' : '🔒'}</span>
        <span>{isShared ? 'Geteilt' : 'Teilen'}</span>
      </button>
      {error && (
        <span className="mt-1 text-xs text-red-600" role="alert">{error}</span>
      )}
    </div>
  )
}
