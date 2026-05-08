import { useEffect, useRef, useState } from 'react'

import {
  fetchCurrentUser,
  logout,
  switchWorkspace,
} from '@/lib/workspace-auth'
import type { CurrentUser, Membership, MeResponse } from '@/lib/workspace-auth'

/**
 * Workspace switcher pinned to the bottom of the chat sidebar (Plan A.5).
 *
 *   ┌──────────────────────────┐
 *   │ ▰▰▰ Stratex          ▾  │  ← color-bar + name + caret
 *   │      👤 Phil             │
 *   └──────────────────────────┘
 *
 * Click → dropdown lists every workspace the user is a member of plus
 * Account/Logout entries. Selecting a different workspace POSTs to
 * `/api/workspaces/<id>/switch` and reloads.
 *
 * In legacy mode (pre-migration) the component returns null — there is
 * only one workspace to switch to, no value in showing the dropdown.
 */
export function WorkspaceSwitcher({
  collapsed = false,
}: {
  collapsed?: boolean
} = {}) {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void fetchCurrentUser().then((res) => {
      if (res && 'mode' in res && res.mode === 'multi-tenant') {
        setMe(res as MeResponse)
      } else {
        setMe(null)
      }
    })
  }, [])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  if (!me) return null
  const active = me.memberships.find((m) => m.workspaceId === me.activeWorkspaceId)
    ?? me.memberships[0]
  if (!active) return null

  if (collapsed) {
    return (
      <div className="px-2 pb-2">
        <div
          className="h-8 w-full rounded-md"
          style={{ backgroundColor: active.branding.primaryColor }}
          title={`${active.name} — ${me.user.name}`}
        />
      </div>
    )
  }

  return (
    <div ref={ref} className="relative px-2 pb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-2 py-2 text-left transition-all hover:bg-primary-100"
      >
        <span
          className="h-8 w-1.5 shrink-0 rounded-sm"
          style={{ backgroundColor: active.branding.primaryColor }}
          aria-hidden
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold text-primary-900">
            {active.name}
          </span>
          <span className="truncate text-xs text-primary-600">
            👤 {me.user.name}
          </span>
        </span>
        <svg width="14" height="14" viewBox="0 0 20 20" className="shrink-0 text-primary-500">
          <path d="M5 8 L10 13 L15 8" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open && (
        <SwitcherDropdown me={me} activeId={active.workspaceId} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}

function SwitcherDropdown({
  me,
  activeId,
  onClose,
}: {
  me: MeResponse
  activeId: string
  onClose: () => void
}) {
  return (
    <div
      role="menu"
      className="absolute bottom-full left-2 right-2 mb-2 overflow-hidden rounded-lg border border-primary-200 bg-primary-50 shadow-xl"
    >
      <ul className="max-h-72 overflow-y-auto py-1">
        {me.memberships.map((m) => (
          <WorkspaceRow
            key={m.workspaceId}
            membership={m}
            active={m.workspaceId === activeId}
            user={me.user}
          />
        ))}
      </ul>
      <div className="border-t border-primary-200">
        <a
          href="/account"
          className="block px-3 py-2 text-sm text-primary-800 hover:bg-primary-100"
        >
          ⚙ Account
        </a>
        {(me.user.defaultWorkspaceId
          ? canSeeWorkspaceSettings(me, activeId)
          : false) && (
          <a
            href={`/workspace/${activeId}/settings`}
            className="block px-3 py-2 text-sm text-primary-800 hover:bg-primary-100"
          >
            ⚙ Workspace-Einstellungen
          </a>
        )}
        <button
          type="button"
          onClick={async () => {
            try {
              await logout()
            } catch {
              /* ignore — clear cookie below regardless */
            }
            onClose()
            window.location.reload()
          }}
          className="block w-full border-t border-primary-200 px-3 py-2 text-left text-sm text-primary-800 hover:bg-primary-100"
        >
          ↩ Abmelden
        </button>
      </div>
    </div>
  )
}

function WorkspaceRow({
  membership,
  active,
  user,
}: {
  membership: Membership
  active: boolean
  user: CurrentUser
}) {
  return (
    <li>
      <button
        type="button"
        onClick={async () => {
          if (active) return
          try {
            await switchWorkspace(membership.workspaceId)
          } catch {
            /* ignore — reload anyway, server is source of truth */
          }
          window.location.reload()
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-primary-100"
      >
        <span
          className="h-7 w-1.5 shrink-0 rounded-sm"
          style={{ backgroundColor: membership.branding.primaryColor }}
          aria-hidden
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-primary-900">{membership.name}</span>
          <span className="truncate text-xs text-primary-500">
            {membership.role}
          </span>
        </span>
        {active && <span className="text-accent-500">✓</span>}
      </button>
      {void user}
    </li>
  )
}

function canSeeWorkspaceSettings(me: MeResponse, wsId: string): boolean {
  const m = me.memberships.find((x) => x.workspaceId === wsId)
  return m?.role === 'owner' || m?.role === 'admin'
}
