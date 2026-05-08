import { Link, Outlet, useParams, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { fetchCurrentUser } from '@/lib/workspace-auth'
import type { Membership, MeResponse } from '@/lib/workspace-auth'

const TABS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'members', label: 'Members' },
  { id: 'roster', label: 'Roster' },
  { id: 'federation', label: 'Federation' },
  { id: 'audit', label: 'Audit Log' },
]

/**
 * Layout component for /workspace/$id/settings/* — left rail with tabs,
 * outlet for the active tab. Visibility is gated by membership: a
 * non-member who lands on the URL directly sees a 404-ish message
 * (matches the API behavior — no info leak).
 */
export function WorkspaceSettingsScreen() {
  const { id: wsId } = useParams({ strict: false }) as { id: string }
  const routerState = useRouterState()
  const [me, setMe] = useState<MeResponse | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)

  useEffect(() => {
    void fetchCurrentUser().then((res) => {
      if (res && 'mode' in res && res.mode === 'multi-tenant') {
        setMe(res as MeResponse)
      }
    })
  }, [])

  if (!me) {
    return (
      <div className="flex h-full items-center justify-center text-primary-500">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-300 border-t-accent-500" />
      </div>
    )
  }
  const membership = me.memberships.find((m) => m.workspaceId === wsId) ?? null
  if (!membership) {
    return (
      <div className="mx-auto max-w-md py-16 text-center text-primary-700">
        <h2 className="mb-2 text-lg font-semibold">Workspace nicht gefunden</h2>
        <p className="text-sm">Du bist kein Member von „{wsId}".</p>
      </div>
    )
  }
  if (unauthorized) {
    return (
      <div className="mx-auto max-w-md py-16 text-center text-primary-700">
        <h2 className="mb-2 text-lg font-semibold">Keine Berechtigung</h2>
        <p className="text-sm">Diese Ansicht ist Owner und Admins vorbehalten.</p>
      </div>
    )
  }
  if (membership.role === 'member') {
    setUnauthorized(true)
    return null
  }

  const currentTab = inferActiveTab(routerState.location.pathname, wsId)

  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 border-r theme-border bg-primary-50/50 px-3 py-4">
        <div className="mb-4 flex items-center gap-2 px-2">
          <span
            className="h-7 w-1.5 rounded-sm"
            style={{ backgroundColor: membership.branding.primaryColor }}
            aria-hidden
          />
          <div className="min-w-0">
            <div className="truncate text-xs uppercase tracking-wide text-primary-500">
              Workspace
            </div>
            <div className="truncate text-sm font-semibold text-primary-900">
              {membership.name}
            </div>
          </div>
        </div>
        <nav className="space-y-0.5">
          {TABS.map((tab) => {
            const active = currentTab === tab.id
            return (
              <Link
                key={tab.id}
                to="/workspace/$id/settings/$tab"
                params={{ id: wsId, tab: tab.id }}
                className={
                  'block rounded-md px-3 py-2 text-sm transition-colors '
                  + (active
                    ? 'bg-primary-200 font-medium text-primary-900'
                    : 'text-primary-700 hover:bg-primary-100')
                }
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}

function inferActiveTab(pathname: string, wsId: string): string {
  const prefix = `/workspace/${wsId}/settings/`
  if (!pathname.startsWith(prefix)) return 'general'
  const slice = pathname.slice(prefix.length)
  const head = slice.split('/')[0]
  return TABS.some((t) => t.id === head) ? head : 'general'
}

export type WorkspaceSettingsContext = {
  wsId: string
  membership: Membership
  user: MeResponse['user']
}
