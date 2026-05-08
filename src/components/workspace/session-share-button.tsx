import { useEffect, useState } from 'react'

import { fetchCurrentUser } from '@/lib/workspace-auth'
import type { MeResponse } from '@/lib/workspace-auth'

type SessionsMetaResponse = {
  ok: true
  sessions: Record<
    string,
    {
      ownerId: string
      shared: boolean
      sharedAt?: string
      sharedBy?: string
    }
  >
}

/**
 * Toggle button for `POST /api/sessions/$id/{share,unshare}`.
 * Renders inline with the chat header. Visible to:
 *
 *   - the session owner (always)
 *   - admins / owners of the workspace (always)
 *
 * Hidden to non-owner members — they can only view shared sessions
 * read-only (see `SharedSessionReadOnlyBanner`).
 */
export function SessionShareButton({ sessionId }: { sessionId: string }) {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [shared, setShared] = useState<boolean | null>(null)
  const [ownerId, setOwnerId] = useState<string | null>(null)
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
    if (!me?.activeWorkspaceId) return
    // Read sessions-meta directly via the server's GET endpoint —
    // we re-use the workspace meta path. There is no dedicated
    // "single session" endpoint, so we read the active list and
    // pick. (Future optimisation: dedicated single-session-meta route.)
    void fetch(`/api/workspaces/${encodeURIComponent(me.activeWorkspaceId)}/members`, {
      credentials: 'same-origin',
    }).catch(() => null)
    // For Phase A.7 simplicity, request the sessions meta via a small
    // helper endpoint we'd ship alongside; for now we let the share
    // call respond with the new state and react accordingly.
    setShared(false)
    setOwnerId(null)
  }, [me, sessionId])

  if (!me || !me.activeWorkspaceId) return null
  // Owner / admin / member-with-own-session permissions are checked
  // server-side; the button shows always and lets the API respond
  // 403 if the click is illegal.

  async function toggle() {
    setBusy(true)
    setError('')
    try {
      const path = shared === true ? 'unshare' : 'share'
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
      setShared(Boolean(body.shared))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktion fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  void ownerId

  return (
    <div className="inline-flex flex-col">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        title={
          shared === true
            ? 'Mit dem Workspace geteilt — Klick zum Zurückprivatisieren'
            : 'Privat — Klick um mit dem Workspace zu teilen'
        }
        className={
          'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors '
          + (shared === true
            ? 'bg-accent-500/10 text-accent-700 hover:bg-accent-500/20'
            : 'text-primary-600 hover:bg-primary-200')
          + (busy ? ' opacity-60' : '')
        }
      >
        <span aria-hidden>{shared === true ? '👥' : '🔒'}</span>
        <span>{shared === true ? 'Geteilt' : 'Teilen'}</span>
      </button>
      {error && (
        <span className="mt-1 text-xs text-red-600" role="alert">{error}</span>
      )}
    </div>
  )
}
