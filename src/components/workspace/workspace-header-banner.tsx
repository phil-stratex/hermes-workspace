import { useEffect, useState } from 'react'

import { fetchCurrentUser } from '@/lib/workspace-auth'
import type { Membership, MeResponse } from '@/lib/workspace-auth'

/**
 * Thin colored bar that sticks to the top of every authenticated
 * page. Reads `meta.branding.primaryColor` of the active workspace
 * so the operator can never accidentally believe they are in the
 * wrong context — different workspaces look visibly different at a
 * glance.
 *
 * Returns null in legacy mode and on unauthenticated routes (the
 * fetchCurrentUser call returns user=null then).
 */
export function WorkspaceHeaderBanner() {
  const [me, setMe] = useState<MeResponse | null>(null)

  useEffect(() => {
    void fetchCurrentUser().then((res) => {
      if (res && 'mode' in res && res.mode === 'multi-tenant') {
        setMe(res as MeResponse)
      }
    })
  }, [])

  if (!me) return null
  const active = pickActiveMembership(me)
  if (!active) return null

  return (
    <div
      role="region"
      aria-label="active-workspace"
      className="sticky top-0 z-40 flex h-1.5 w-full"
      style={{ backgroundColor: active.branding.primaryColor }}
      title={`${active.name} — ${me.user.name}`}
    />
  )
}

function pickActiveMembership(me: MeResponse): Membership | null {
  if (me.activeWorkspaceId) {
    const m = me.memberships.find((x) => x.workspaceId === me.activeWorkspaceId)
    if (m) return m
  }
  return me.memberships[0] ?? null
}
