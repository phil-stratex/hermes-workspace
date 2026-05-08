import { useEffect, useState } from 'react'

import { fetchCurrentUser } from '@/lib/workspace-auth'
import type { MeResponse } from '@/lib/workspace-auth'

type Issue = {
  wsId: string
  file: string
  errors: Array<string>
}

/**
 * Sticky alert that shows up when the boot-time roster validator
 * (Plan-Finding L3) flagged the current workspace's Custom-roster as
 * outdated. Renders only for owner/admin in the affected workspace.
 *
 * Returns null in legacy mode, on a clean stack, or when no issue
 * exists for the active workspace.
 */
export function RosterIssuesBanner() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [issues, setIssues] = useState<Array<Issue>>([])
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    void fetchCurrentUser().then((res) => {
      if (res && 'mode' in res && res.mode === 'multi-tenant') {
        setMe(res as MeResponse)
      }
    })
  }, [])

  useEffect(() => {
    if (!me) return
    void fetch('/api/swarm-yaml-issues', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d: { issues?: Array<Issue> }) => setIssues(d.issues ?? []))
      .catch(() => setIssues([]))
  }, [me])

  if (!me || dismissed) return null
  const active = me.activeWorkspaceId
  if (!active) return null
  const myIssue = issues.find((i) => i.wsId === active)
  if (!myIssue) return null
  // only show to admins/owners — members can't fix it anyway
  const m = me.memberships.find((x) => x.workspaceId === active)
  if (!m || m.role === 'member') return null

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
      <div className="flex items-center gap-2">
        <span className="font-semibold">⚠ Custom-Roster veraltet</span>
        <span className="opacity-80">
          {myIssue.errors.length} Problem{myIssue.errors.length === 1 ? '' : 'e'} —
        </span>
        <a
          href={`/workspace/${active}/settings/roster`}
          className="underline hover:no-underline"
        >
          Roster-Tab öffnen
        </a>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="ml-auto rounded p-0.5 text-amber-700 hover:bg-amber-100"
          aria-label="Banner schließen"
        >✕</button>
      </div>
    </div>
  )
}
