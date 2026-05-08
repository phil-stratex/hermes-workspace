import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { requirePermission } from '../../server/auth-middleware'
import { FederationMcpClient } from '../../server/federation-mcp-client'
import {
  computeDiff,
  readRemote,
} from '../../server/federation-sync-engine'
import { getPeer } from '../../server/federation-peers-store'
import { emitFederationEvent } from '../../server/federation-audit'
import { requireJsonContentType } from '../../server/rate-limit'

/**
 * POST /api/workspaces/$wsId/federation/diff/$peerId
 *
 * Read-only — computes the diff between local + peer remote, returns
 * the full plan (in/out/conflicts/warnings) for the SyncWizard's
 * mandatory diff-preview step. No side effects on the workspace
 * tree; emits a `federation_diff_computed` audit event so the
 * forensic trail captures every probe.
 */
export const Route = createFileRoute('/api/workspaces/$wsId/federation/diff/$peerId')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        const guard = requirePermission(request, params.wsId, 'federation-manage')
        if (!guard.ok) return guard.response
        const peer = getPeer(params.wsId, params.peerId)
        if (!peer) return json({ ok: false, error: 'Peer not found' }, { status: 404 })

        const client = new FederationMcpClient({
          user: peer.sshUser,
          host: peer.host,
          port: peer.sshPort,
          privateKeyPath: peer.sshKeyPath,
        })
        try {
          const remote = await readRemote(client)
          const diff = computeDiff({
            wsId: params.wsId,
            peerId: params.peerId,
            syncedTypes: peer.syncedTypes,
            remote,
          })
          await emitFederationEvent(params.wsId, {
            type: 'federation_diff_computed',
            actorUserId: guard.value.user.id,
            peerId: params.peerId,
            summary: {
              inCount: diff.inItems.length,
              outCount: diff.outItems.length,
              conflictCount: diff.conflicts.length,
            },
            warnings: {
              massInDelete: diff.warnings.massInDelete,
              massOutDelete: diff.warnings.massOutDelete,
            },
          })
          return json({ ok: true, diff })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : 'diff failed' },
            { status: 503 },
          )
        } finally {
          client.close()
        }
      },
    },
  },
})
