import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { requirePermission } from '../../server/auth-middleware'
import { getPeer, setPeerStatus } from '../../server/federation-peers-store'
import { emitFederationEvent } from '../../server/federation-audit'
import { requireJsonContentType } from '../../server/rate-limit'

export const Route = createFileRoute('/api/workspaces/$wsId/federation/disconnect/$peerId')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        const guard = requirePermission(request, params.wsId, 'federation-manage')
        if (!guard.ok) return guard.response
        const peer = getPeer(params.wsId, params.peerId)
        if (!peer) return json({ ok: false, error: 'Peer not found' }, { status: 404 })
        await setPeerStatus(params.wsId, params.peerId, 'disconnected')
        await emitFederationEvent(params.wsId, {
          type: 'federation_disconnect',
          actorUserId: guard.value.user.id,
          peerId: params.peerId,
          reason: 'manual',
        })
        return json({ ok: true, status: 'disconnected' })
      },
    },
  },
})
