import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'

import { requirePermission } from '../../server/auth-middleware'
import {
  deletePeer,
  getPeer,
  updatePeer,
} from '../../server/federation-peers-store'
import { emitFederationEvent } from '../../server/federation-audit'
import { requireJsonContentType } from '../../server/rate-limit'

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  host: z.string().min(1).max(255).optional(),
  sshUser: z.string().min(1).max(64).optional(),
  sshPort: z.number().int().min(1).max(65535).optional(),
  syncedTypes: z.array(z.enum([
    'memories', 'skills', 'council', 'sessions-shared', 'audit', 'roster',
  ])).min(1).optional(),
  notes: z.string().max(2000).optional(),
})

export const Route = createFileRoute('/api/workspaces/$wsId/federation/peers/$peerId')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        const guard = requirePermission(request, params.wsId, 'federation-manage')
        if (!guard.ok) return guard.response
        if (!getPeer(params.wsId, params.peerId)) {
          return json({ ok: false, error: 'Peer not found' }, { status: 404 })
        }
        const raw = await request.json().catch(() => ({}))
        const parsed = PatchSchema.safeParse(raw)
        if (!parsed.success) {
          return json({ ok: false, error: 'Invalid request' }, { status: 400 })
        }
        const next = await updatePeer(params.wsId, params.peerId, (p) => ({
          ...p,
          name: parsed.data.name ?? p.name,
          host: parsed.data.host ?? p.host,
          sshUser: parsed.data.sshUser ?? p.sshUser,
          sshPort: parsed.data.sshPort ?? p.sshPort,
          syncedTypes: parsed.data.syncedTypes ?? p.syncedTypes,
          notes: parsed.data.notes ?? p.notes,
        }))
        if (!next) return json({ ok: false, error: 'Peer not found' }, { status: 404 })
        await emitFederationEvent(params.wsId, {
          type: 'federation_peer_updated',
          actorUserId: guard.value.user.id,
          peerId: params.peerId,
          patch: parsed.data,
        })
        return json({ ok: true, peer: next })
      },
      DELETE: async ({ request, params }) => {
        const guard = requirePermission(request, params.wsId, 'federation-manage')
        if (!guard.ok) return guard.response
        const ok = await deletePeer(params.wsId, params.peerId)
        if (!ok) return json({ ok: false, error: 'Peer not found' }, { status: 404 })
        await emitFederationEvent(params.wsId, {
          type: 'federation_peer_deleted',
          actorUserId: guard.value.user.id,
          peerId: params.peerId,
        })
        return json({ ok: true })
      },
    },
  },
})
