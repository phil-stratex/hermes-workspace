import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { requirePermission } from '../../server/auth-middleware'
import { listAuditFiles, readAuditChain } from '../../server/audit-log'
import { appendAuditEvent } from '../../server/audit-log'

/**
 * GET /api/workspaces/$id/audit
 *   ?date=YYYY-MM-DD     read a specific day (default: today)
 *   ?listDays=1          return the available day-files instead of entries
 *
 * Plan-Finding F10: every read recomputes the hash chain. If
 * `brokenAt !== null` the response carries the index + reason, the
 * `AuditViewer` UI surfaces a prominent alert, AND we emit a
 * `chain_break_detected` event into the same audit log so the break
 * itself is recorded — turning silent tampering into a visible
 * forensic trail.
 *
 * Gated on `audit-view` action (owner/admin only).
 */
export const Route = createFileRoute('/api/workspaces/$id/audit')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const guard = requirePermission(request, params.id, 'audit-view')
        if (!guard.ok) return guard.response

        const url = new URL(request.url)
        if (url.searchParams.get('listDays') === '1') {
          const files = listAuditFiles({ type: 'workspace', wsId: params.id })
          const days = files.map((f) => f.replace(/\.jsonl$/, ''))
          return json({ ok: true, days })
        }
        const dateISO = url.searchParams.get('date') ?? new Date().toISOString()
        const result = readAuditChain({ type: 'workspace', wsId: params.id }, dateISO)

        if (result.brokenAt !== null) {
          // Self-recording: break detection lands in the same scope so
          // the next read shows it AND the chain break is part of the
          // chain. The new event becomes the new last-hash, so the
          // post-break chain remains valid going forward.
          try {
            await appendAuditEvent(
              { type: 'workspace', wsId: params.id },
              {
                type: 'chain_break_detected',
                detectedBy: guard.value.user.id,
                brokenAt: result.brokenAt,
                breakReason: result.breakReason,
                file: dateISO.slice(0, 10),
              },
            )
          } catch {
            // Don't block the read if the recording itself fails.
          }
        }
        return json({
          ok: true,
          entries: result.entries,
          brokenAt: result.brokenAt,
          breakReason: result.breakReason,
        })
      },
    },
  },
})
