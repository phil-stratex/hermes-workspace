import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { requirePermission } from '../../server/auth-middleware'
import { listAuditFiles, readAuditChain } from '../../server/audit-log'
import { emitFederationEvent } from '../../server/federation-audit'

/**
 * GET /api/workspaces/$wsId/federation/audit
 *   ?date=YYYY-MM-DD     read a specific day (default today)
 *   ?listDays=1          return available day-files only
 *
 * Same Plan-Finding F10 chain-validation semantics as the workspace
 * audit endpoint — but filtered to only federation-prefixed events.
 */
export const Route = createFileRoute('/api/workspaces/$wsId/federation/audit')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const guard = requirePermission(request, params.wsId, 'audit-view')
        if (!guard.ok) return guard.response

        const url = new URL(request.url)
        if (url.searchParams.get('listDays') === '1') {
          const days = listAuditFiles({ type: 'workspace', wsId: params.wsId })
            .map((f) => f.replace(/\.jsonl$/, ''))
          return json({ ok: true, days })
        }
        const dateISO = url.searchParams.get('date') ?? new Date().toISOString()
        const result = readAuditChain({ type: 'workspace', wsId: params.wsId }, dateISO)
        const federationOnly = result.entries.filter((e) =>
          typeof e.type === 'string' && e.type.startsWith('federation_'),
        )

        if (result.brokenAt !== null) {
          try {
            await emitFederationEvent(params.wsId, {
              type: 'federation_chain_break_detected',
              detectedBy: guard.value.user.id,
              peerId: 'unknown',
              brokenAt: result.brokenAt,
              breakReason: result.breakReason,
            })
          } catch {
            // never block the read on the recording
          }
        }
        return json({
          ok: true,
          entries: federationOnly,
          brokenAt: result.brokenAt,
          breakReason: result.breakReason,
        })
      },
    },
  },
})
