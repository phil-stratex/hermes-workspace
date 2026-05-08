import { useEffect, useState } from 'react'

import { fetchCurrentUser } from '@/lib/workspace-auth'
import type { Membership, MeResponse } from '@/lib/workspace-auth'

export type WorkspaceContext = {
  wsId: string
  user: MeResponse['user']
  membership: Membership
  me: MeResponse
}

/**
 * Resolve the current workspace + membership for a settings tab.
 * Returns `null` while loading, throws (via React error boundary) if
 * the user is not a member — the parent layout handles that case.
 */
export function useWorkspaceContext(wsId: string): WorkspaceContext | null {
  const [me, setMe] = useState<MeResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchCurrentUser().then((res) => {
      if (cancelled) return
      if (res && 'mode' in res && res.mode === 'multi-tenant') {
        setMe(res as MeResponse)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!me) return null
  const membership = me.memberships.find((m) => m.workspaceId === wsId)
  if (!membership) return null
  return { wsId, user: me.user, membership, me }
}
