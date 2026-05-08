import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { requireUser } from '../../server/auth-middleware'
import { canDo } from '../../server/permissions'
import { readIssuesReport } from '../../server/swarm-yaml-validator'

/**
 * GET /api/swarm-yaml-issues
 *
 * Read-only summary of `data/global/swarm-yaml-issues.json` — the
 * Boot-Time roster validator's last verdict (Plan-Finding L3). Used
 * by the `RosterIssuesBanner` to alert workspace owners about
 * Custom-roster files that reference Worker-IDs which no longer
 * exist in the code implementation.
 *
 * Authority: requires login. The response is filtered to issues for
 * workspaces where the caller has `roster-edit` — admins see only
 * their own workspaces' problems, not other tenants'.
 */
export const Route = createFileRoute('/api/swarm-yaml-issues')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireUser(request)
        if (!auth.ok) return auth.response
        const report = readIssuesReport()
        if (!report) {
          return json({ ok: true, issues: [], scannedAt: null })
        }
        const visible = report.issues.filter((i) =>
          canDo(auth.value.id, i.wsId, 'roster-edit'),
        )
        return json({
          ok: true,
          issues: visible,
          scannedAt: report.scannedAt,
        })
      },
    },
  },
})
