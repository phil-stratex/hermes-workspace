/**
 * NotificationBell — header chip showing the count of unread fatal+error
 * entries from the last 24 h. Click → top-5 dropdown + "Alle ansehen"
 * link to `/errors`.
 *
 * Stack-Admin-only — gated by `useCanSeeErrors`. Multi-tenant-only —
 * `lastErrorSeenAt` rides on `data/users/<id>/preferences.json` which
 * doesn't exist in legacy single-PW mode (`/api/users/me/preferences`
 * returns 404 there, the bell renders nothing).
 *
 * N3 — 60 s `staleTime` matches the sidebar visibility probe so the
 * two queries deduplicate on the same key.
 */

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Notification01Icon } from '@hugeicons/core-free-icons'

import { useCanSeeErrors } from '@/hooks/use-can-see-errors'

type ListEntry = {
  id: string
  ts: string
  level: string
  source: string
  message: string
}

type ListResponse = {
  ok: boolean
  total: number
  entries: Array<ListEntry>
}

type PreferencesResponse = {
  ok: boolean
  preferences: { lastErrorSeenAt?: string }
}

function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function NotificationBell() {
  const visibility = useCanSeeErrors()
  const [open, setOpen] = useState(false)

  // Recent fatal+error in last 24h.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const errorsQuery = useQuery({
    enabled: visibility.canSee,
    queryKey: ['errors-bell-list', since],
    queryFn: async () => {
      const params = new URLSearchParams({
        level: 'fatal,error',
        since,
        limit: '5',
      })
      const res = await fetch(`/api/errors?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as ListResponse
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  // User-preferences (lastErrorSeenAt). Multi-tenant only — gracefully
  // degrades when /api/users/me/preferences returns 404 in legacy mode.
  const prefsQuery = useQuery({
    enabled: visibility.canSee,
    queryKey: ['user-preferences-me'],
    queryFn: async () => {
      const res = await fetch('/api/users/me/preferences')
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as PreferencesResponse
    },
    staleTime: 60_000,
    retry: false,
  })

  const lastSeenAt = prefsQuery.data?.preferences?.lastErrorSeenAt
  const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : 0
  const unreadEntries = (errorsQuery.data?.entries ?? []).filter(
    (e) => new Date(e.ts).getTime() > lastSeenMs,
  )
  const unreadCount = unreadEntries.length

  const markSeen = useMutation({
    mutationFn: async (): Promise<void> => {
      await fetch('/api/users/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastErrorSeenAt: new Date().toISOString() }),
      })
    },
    onSuccess: () => {
      void prefsQuery.refetch()
    },
  })

  if (!visibility.canSee) return null
  // Bell is multi-tenant only. In legacy single-PW (prefsQuery resolved
  // to null), keep the icon visible but skip the per-user unread-state.
  const isLegacy = prefsQuery.data === null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o)
          if (!open && unreadCount > 0) {
            markSeen.mutate()
          }
        }}
        className="relative inline-flex size-8 items-center justify-center rounded-md hover:opacity-80"
        style={{ color: 'var(--theme-text)' }}
        aria-label={`${unreadCount} unread errors`}
      >
        <HugeiconsIcon icon={Notification01Icon} size={18} />
        {!isLegacy && unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none"
            style={{ background: '#ef4444', color: '#fff' }}
          >
            {unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute right-0 top-9 z-50 w-80 rounded-lg p-2 shadow-xl"
          style={{
            background: 'var(--theme-panel)',
            border: '1px solid var(--theme-border)',
            color: 'var(--theme-text)',
          }}
        >
          {(errorsQuery.data?.entries ?? []).length === 0 ? (
            <div className="p-3 text-xs opacity-60">Keine neuen Errors.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {(errorsQuery.data?.entries ?? []).slice(0, 5).map((e) => (
                <Link
                  key={e.id}
                  to="/errors/$id"
                  params={{ id: e.id }}
                  className="rounded p-2 text-xs hover:opacity-80"
                  onClick={() => setOpen(false)}
                  style={{
                    background:
                      e.level === 'fatal'
                        ? 'rgba(220,38,38,0.1)'
                        : 'rgba(248,113,113,0.06)',
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono uppercase opacity-70">{e.level}</span>
                    <span className="opacity-50">{fmtTime(e.ts)}</span>
                  </div>
                  <div className="truncate">{e.message}</div>
                  <div className="text-[10px] opacity-50">{e.source}</div>
                </Link>
              ))}
            </div>
          )}
          <Link
            to="/errors"
            className="mt-2 block rounded p-2 text-center text-xs underline hover:opacity-80"
            onClick={() => setOpen(false)}
          >
            Alle ansehen →
          </Link>
        </div>
      )}
    </div>
  )
}
