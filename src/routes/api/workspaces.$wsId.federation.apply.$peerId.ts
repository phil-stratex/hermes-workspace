import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'

import { requirePermission } from '../../server/auth-middleware'
import { FederationMcpClient } from '../../server/federation-mcp-client'
import {
  applyDiff,
  computeDiff,
  readRemote,
} from '../../server/federation-sync-engine'
import { getPeer, recordSyncSummary } from '../../server/federation-peers-store'
import { requireJsonContentType } from '../../server/rate-limit'

const ApplySchema = z.object({
  selective: z.array(
    z.object({
      path: z.string().min(1).max(2000),
      resolve: z.enum(['local', 'remote']).optional(),
      remoteSha256: z.string().optional(),
    }),
  ),
})

/**
 * POST /api/workspaces/$wsId/federation/apply/$peerId
 *
 * Recomputes the diff (so the operator can never accept a stale
 * plan) and applies the operator's selection. Returns the per-item
 * outcome for the wizard to display.
 */
export const Route = createFileRoute('/api/workspaces/$wsId/federation/apply/$peerId')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        const guard = requirePermission(request, params.wsId, 'federation-manage')
        if (!guard.ok) return guard.response
        const peer = getPeer(params.wsId, params.peerId)
        if (!peer) return json({ ok: false, error: 'Peer not found' }, { status: 404 })

        const raw = await request.json().catch(() => ({}))
        const parsed = ApplySchema.safeParse(raw)
        if (!parsed.success) {
          return json({ ok: false, error: 'Invalid request' }, { status: 400 })
        }

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

          const result = await applyDiff({
            wsId: params.wsId,
            peerId: params.peerId,
            diff,
            selective: parsed.data.selective,
            actorUserId: guard.value.user.id,
            fetchRemoteContent: async (path: string) => {
              if (path.startsWith('memories/')) {
                const r = await client.call<{ content: string }>('get_memory', { path })
                if (!r.ok) throw new Error(r.error.message)
                return r.result.content
              }
              if (path.startsWith('skills/') && path.endsWith('/SKILL.md')) {
                const name = path.slice('skills/'.length, path.length - '/SKILL.md'.length)
                const r = await client.call<{ content: string }>('get_skill', { name })
                if (!r.ok) throw new Error(r.error.message)
                return r.result.content
              }
              if (path.startsWith('sessions/shared/') && path.endsWith('.json')) {
                const id = path.slice('sessions/shared/'.length, path.length - '.json'.length)
                const r = await client.call<{ content: string }>('get_session_snapshot', { id })
                if (!r.ok) throw new Error(r.error.message)
                return r.result.content
              }
              throw new Error(`Unsupported sync path: ${path}`)
            },
          })

          await recordSyncSummary(params.wsId, params.peerId, {
            in: result.applied.add + result.applied.update + result.applied.delete,
            out: diff.outItems.length,
            conflicts: result.conflictsResolved,
          })

          return json({ ok: true, result, diff })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : 'apply failed' },
            { status: 503 },
          )
        } finally {
          client.close()
        }
      },
    },
  },
})
