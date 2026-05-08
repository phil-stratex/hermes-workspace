import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'

import { requirePermission } from '../../server/auth-middleware'
import { isValidSlug } from '../../server/data-paths'
import {
  addPeer,
  generatePeerId,
  readPeers,
} from '../../server/federation-peers-store'
import {
  buildAuthorizedKeysLine,
  generateKeypair,
} from '../../server/federation-tunnel'
import { emitFederationEvent } from '../../server/federation-audit'
import { requireJsonContentType } from '../../server/rate-limit'

const SyncedTypeSchema = z.enum([
  'memories',
  'skills',
  'council',
  'sessions-shared',
  'audit',
  'roster',
])

const AddPeerSchema = z.object({
  name: z.string().min(1).max(200),
  host: z.string().min(1).max(255),
  sshUser: z.string().min(1).max(64),
  sshPort: z.number().int().min(1).max(65535).optional(),
  remoteWorkspaceId: z.string(),
  syncedTypes: z.array(SyncedTypeSchema).min(1),
  notes: z.string().max(2000).optional(),
  /** Optional pre-generated key pair (operator already has SSH-set-up
   *  on the peer). When omitted we run ssh-keygen and return the
   *  public key for the wizard to display. */
  containerName: z.string().max(200).optional(),
})

export const Route = createFileRoute('/api/workspaces/$wsId/federation/peers')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const guard = requirePermission(request, params.wsId, 'federation-manage')
        if (!guard.ok) return guard.response
        const cfg = readPeers(params.wsId)
        return json({
          ok: true,
          peers: cfg.peers.map((p) => ({
            id: p.id,
            name: p.name,
            host: p.host,
            sshUser: p.sshUser,
            sshPort: p.sshPort,
            remoteWorkspaceId: p.remoteWorkspaceId,
            syncedTypes: p.syncedTypes,
            status: p.status,
            createdAt: p.createdAt,
            createdBy: p.createdBy,
            lastSync: p.lastSync,
            notes: p.notes,
            // publicKey + sshKeyPath are NOT returned to keep the
            // private path away from the wire even if a future bug
            // reaches the API client.
          })),
        })
      },
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        const guard = requirePermission(request, params.wsId, 'federation-manage')
        if (!guard.ok) return guard.response
        const raw = await request.json().catch(() => ({}))
        const parsed = AddPeerSchema.safeParse(raw)
        if (!parsed.success) {
          return json(
            { ok: false, error: 'Invalid request', issues: parsed.error.issues },
            { status: 400 },
          )
        }
        if (!isValidSlug(parsed.data.remoteWorkspaceId)) {
          return json({ ok: false, error: 'Invalid remoteWorkspaceId' }, { status: 400 })
        }

        // Generate the per-peer SSH key pair before adding the peer
        // so we can record the private key path on the peer record.
        const peerId = generatePeerId()
        let publicKey: string
        let sshKeyPath: string
        try {
          const kp = generateKeypair({ wsId: params.wsId, peerId, comment: parsed.data.name })
          publicKey = kp.publicKey
          sshKeyPath = kp.privateKeyPath
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : 'keygen failed' },
            { status: 500 },
          )
        }

        try {
          const peer = await addPeer({
            wsId: params.wsId,
            name: parsed.data.name,
            host: parsed.data.host,
            sshUser: parsed.data.sshUser,
            sshPort: parsed.data.sshPort,
            publicKey,
            sshKeyPath,
            remoteWorkspaceId: parsed.data.remoteWorkspaceId,
            syncedTypes: parsed.data.syncedTypes,
            createdBy: guard.value.user.id,
            notes: parsed.data.notes,
          })
          // Override the auto-generated id with the one we used for
          // keygen so the key file matches.
          ;(peer as { id: string }).id = peerId

          await emitFederationEvent(params.wsId, {
            type: 'federation_peer_added',
            actorUserId: guard.value.user.id,
            peerId: peer.id,
            peerName: peer.name,
            remoteWorkspaceId: peer.remoteWorkspaceId,
          })
          const authorizedKeysLine = buildAuthorizedKeysLine({
            containerName: parsed.data.containerName ?? 'hermes-workspace',
            remoteWorkspaceId: peer.remoteWorkspaceId,
            publicKey,
          })
          return json({
            ok: true,
            peer: {
              id: peer.id,
              name: peer.name,
              host: peer.host,
              sshUser: peer.sshUser,
              sshPort: peer.sshPort,
              remoteWorkspaceId: peer.remoteWorkspaceId,
              syncedTypes: peer.syncedTypes,
              status: peer.status,
              createdAt: peer.createdAt,
            },
            // The public key + the exact authorized_keys line for the
            // operator to paste on the peer's VPS. Returned ONCE here
            // because the wizard needs it; subsequent GETs do NOT
            // surface it to keep the surface narrow.
            publicKey,
            authorizedKeysLine,
          })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : 'add failed' },
            { status: 400 },
          )
        }
      },
    },
  },
})
