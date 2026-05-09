'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import { useEffect, useState } from 'react'

import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  fetchCurrentUser,
  logout,
  switchWorkspace,
} from '@/lib/workspace-auth'
import type { CurrentUser, Membership, MeResponse } from '@/lib/workspace-auth'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateWorkspace?: () => void
}

export function WorkspaceSwitcherDialog({ open, onOpenChange, onCreateWorkspace }: Props) {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void fetchCurrentUser().then((res) => {
      if (cancelled) return
      if (res && 'mode' in res && res.mode === 'multi-tenant') {
        setMe(res as MeResponse)
      } else {
        setMe(null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [open])

  const active = me?.memberships.find(
    (m) => m.workspaceId === me.activeWorkspaceId,
  ) ?? me?.memberships[0]

  async function handleSwitch(wsId: string) {
    if (busy) return
    if (active && wsId === active.workspaceId) {
      onOpenChange(false)
      return
    }
    setBusy(wsId)
    try {
      await switchWorkspace(wsId)
    } catch {
      /* server is source of truth — reload anyway */
    }
    window.location.reload()
  }

  async function handleLogout() {
    if (busy) return
    setBusy('__logout__')
    try {
      await logout()
    } catch {
      /* ignore */
    }
    window.location.reload()
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="inset-0 h-full w-full max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 p-0 shadow-xl md:inset-auto md:left-1/2 md:top-1/2 md:h-auto md:max-h-[min(80dvh,640px)] md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border md:border-primary-200 bg-[var(--theme-bg)]">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-primary-200 bg-primary-50/80 px-4 py-4 md:rounded-t-2xl md:px-5">
            <div>
              <DialogTitle className="text-base font-semibold text-primary-900 dark:text-neutral-100">
                Workspace wechseln
              </DialogTitle>
              <DialogDescription className="sr-only">
                Wähle einen Workspace, um zu ihm zu wechseln
              </DialogDescription>
            </div>
            <DialogClose
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="rounded-full text-primary-500 hover:bg-primary-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  aria-label="Close"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={18}
                    strokeWidth={1.5}
                  />
                </Button>
              }
            />
          </div>

          {me && active ? (
            <>
              <ul className="min-h-0 flex-1 overflow-y-auto py-2">
                {me.memberships.map((m) => (
                  <WorkspaceRow
                    key={m.workspaceId}
                    membership={m}
                    active={m.workspaceId === active.workspaceId}
                    user={me.user}
                    busy={busy === m.workspaceId}
                    disabled={busy !== null && busy !== m.workspaceId}
                    onSelect={() => handleSwitch(m.workspaceId)}
                  />
                ))}
              </ul>
              {onCreateWorkspace && (
                <div className="border-t border-primary-200 px-4 py-2 md:px-5">
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false)
                      onCreateWorkspace()
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-primary-300 px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={1.5} />
                    Neuer Workspace
                  </button>
                </div>
              )}
              <div className="border-t border-primary-200 bg-primary-50/40 px-4 py-3 md:rounded-b-2xl md:px-5">
                <div className="flex items-center justify-between gap-2">
                  <a
                    href="/account"
                    className="text-sm text-primary-800 hover:underline dark:text-neutral-200"
                  >
                    Account-Einstellungen
                  </a>
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={busy !== null}
                    className="rounded-md px-3 py-1.5 text-sm text-primary-800 hover:bg-primary-100 disabled:opacity-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    Abmelden
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-4 py-12 text-sm text-primary-600 dark:text-neutral-400">
              {me === null
                ? 'Lade…'
                : 'Keine weiteren Workspaces verfügbar.'}
            </div>
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  )
}

function WorkspaceRow({
  membership,
  active,
  user,
  busy,
  disabled,
  onSelect,
}: {
  membership: Membership
  active: boolean
  user: CurrentUser
  busy: boolean
  disabled: boolean
  onSelect: () => void
}) {
  void user
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-neutral-800 md:px-5 ${
          active ? 'bg-primary-100/60 dark:bg-neutral-800/60' : ''
        }`}
      >
        <span
          className="h-9 w-1.5 shrink-0 rounded-sm"
          style={{ backgroundColor: membership.branding.primaryColor }}
          aria-hidden
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-primary-900 dark:text-neutral-100">
            {membership.name}
          </span>
          <span className="truncate text-xs text-primary-500 dark:text-neutral-400">
            {membership.role}
          </span>
        </span>
        {busy && (
          <span className="text-xs text-primary-500 dark:text-neutral-400">
            …
          </span>
        )}
        {!busy && active && (
          <span className="text-accent-500" aria-label="aktiv">
            ✓
          </span>
        )}
      </button>
    </li>
  )
}
