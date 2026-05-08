import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { requirePermission } from '../../server/auth-middleware'
import {
  getPeer,
  setPeerStatus,
} from '../../server/federation-peers-store'
import { testConnection } from '../../server/federation-tunnel'
import { emitFederationEvent } from '../../server/federation-audit'
import { requireJsonContentType } from '../../server/rate-limit'

/**
 * POST /api/workspaces/$wsId/federation/connect/$peerId
 *
 * Probes the peer SSH path. On success the peer status flips to
 * `connected` (the actual MCP-call lifecycle is short — every
 * `diff` and `apply` opens its own ssh process). On a probe failure
 * we surface the reason so the UI can show "the key isn't installed
 * yet" vs. "the peer is offline" without guessing.
 */
export const Route = createFileRoute('/api/workspaces/$wsId/federation/connect/$peerId')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        const guard = requirePermission(request, params.wsId, 'federation-manage')
        if (!guard.ok) return guard.response
        const peer = getPeer(params.wsId, params.peerId)
        if (!peer) return json({ ok: false, error: 'Peer not found' }, { status: 404 })

        const probe = testConnection({
          user: peer.sshUser,
          host: peer.host,
          port: peer.sshPort,
          privateKeyPath: peer.sshKeyPath,
        })
        if (!probe.ok) {
          await setPeerStatus(params.wsId, params.peerId, 'error')
          return json(
            {
              ok: false,
              error: 'Connection probe failed',
              reason: probe.reason,
              details: probe.details,
            },
            { status: 503 },
          )
        }
        await setPeerStatus(params.wsId, params.peerId, 'connected')
        await emitFederationEvent(params.wsId, {
          type: 'federation_connect',
          actorUserId: guard.value.user.id,
          peerId: params.peerId,
        })
        return json({ ok: true, status: 'connected' })
      },
    },
  },
})
