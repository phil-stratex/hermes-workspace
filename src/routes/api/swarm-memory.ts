import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireWorkspaceAction } from '../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import {
  appendSwarmMemoryEvent,
  ensureWorkerMemoryScaffold,
  readSwarmMemory,
  validateMissionId,
  validateSwarmId,
  writeSwarmHandoff,
  type SwarmMemoryEventType,
  type SwarmMemoryKind,
} from '../../server/swarm-memory'
import { isLegacyDataWorkspace } from '../../server/workspace-data-scope'

type SwarmMemoryPostBody = {
  workerId?: unknown
  kind?: unknown
  missionId?: unknown
  eventType?: unknown
  summary?: unknown
  content?: unknown
  title?: unknown
  assignmentId?: unknown
  event?: unknown
  scaffold?: unknown
  name?: unknown
  role?: unknown
  specialty?: unknown
  model?: unknown
  mirrorShared?: unknown
}

const MEMORY_KINDS = new Set<SwarmMemoryKind>(['profile', 'mission', 'episodic', 'handoff', 'shared'])
const EVENT_TYPES = new Set<SwarmMemoryEventType>([
  'mission-start',
  'dispatch',
  'checkpoint',
  'handoff-requested',
  'handoff-written',
  'resume',
  'blocked',
  'complete',
  'note',
])

function asKind(value: unknown): SwarmMemoryKind {
  return typeof value === 'string' && MEMORY_KINDS.has(value as SwarmMemoryKind)
    ? value as SwarmMemoryKind
    : 'profile'
}

function asEventType(value: unknown): SwarmMemoryEventType {
  return typeof value === 'string' && EVENT_TYPES.has(value as SwarmMemoryEventType)
    ? value as SwarmMemoryEventType
    : 'note'
}

export const Route = createFileRoute('/api/swarm-memory')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireWorkspaceAction(request, 'memory-read')
        if (!auth.ok) return auth.response
        // Swarm-memory is rooted in `~/.openclaw/...` (global). Only the
        // migration-default workspace owns those records; other
        // workspaces see an empty memory store until the data path is
        // wsId-keyed.
        if (!isLegacyDataWorkspace(auth.value.wsId)) {
          return json({ entries: [], reason: 'workspace has no local swarm memory yet' })
        }
        const url = new URL(request.url)
        const workerId = url.searchParams.get('workerId')
        const kind = asKind(url.searchParams.get('kind'))
        const missionId = url.searchParams.get('missionId')
        const date = url.searchParams.get('date')
        try {
          return json(readSwarmMemory({ workerId, kind, missionId, date }))
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : 'Failed to read swarm memory' }, { status: 400 })
        }
      },
      POST: async ({ request }) => {
        const auth = requireWorkspaceAction(request, 'memory-write')
        if (!auth.ok) return auth.response
        // Writes from non-default workspaces would leak into the
        // migration-default's memory store — refuse until per-WS paths.
        if (!isLegacyDataWorkspace(auth.value.wsId)) {
          return json(
            {
              error: 'workspace has no local swarm memory yet',
              hint: 'global swarm memory storage is shared with the migration-default workspace; per-workspace storage is on the Phase-B refactor list',
            },
            { status: 501 },
          )
        }

        let body: SwarmMemoryPostBody
        try {
          body = (await request.json()) as SwarmMemoryPostBody
        } catch {
          return json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const workerId = typeof body.workerId === 'string' ? body.workerId.trim() : ''
        if (!workerId || !validateSwarmId(workerId)) {
          return json({ error: 'Valid workerId required' }, { status: 400 })
        }

        try {
          if (body.scaffold === true) {
            ensureWorkerMemoryScaffold({
              workerId,
              name: typeof body.name === 'string' ? body.name : null,
              role: typeof body.role === 'string' ? body.role : null,
              specialty: typeof body.specialty === 'string' ? body.specialty : null,
              model: typeof body.model === 'string' ? body.model : null,
            })
            return json({ ok: true, workerId, action: 'scaffolded' })
          }

          const kind = asKind(body.kind)
          const missionId = typeof body.missionId === 'string' ? body.missionId.trim() : null
          const eventType = asEventType(body.eventType)
          const summary = typeof body.summary === 'string'
            ? body.summary.trim()
            : typeof body.content === 'string'
              ? body.content.trim().slice(0, 300)
              : ''
          const assignmentId = typeof body.assignmentId === 'string' ? body.assignmentId.trim() : null
          const event = body.event && typeof body.event === 'object' && !Array.isArray(body.event)
            ? body.event as Record<string, unknown>
            : undefined

          if (kind === 'handoff') {
            if (!missionId || !validateMissionId(missionId)) {
              return json({ error: 'Valid missionId required for handoff writes' }, { status: 400 })
            }
            const content = typeof body.content === 'string' ? body.content : ''
            if (!content.trim()) return json({ error: 'handoff content required' }, { status: 400 })
            const written = writeSwarmHandoff({ workerId, missionId, content, mirrorShared: body.mirrorShared !== false })
            appendSwarmMemoryEvent({
              workerId,
              missionId,
              assignmentId,
              type: 'handoff-written',
              summary: summary || `Wrote handoff for ${missionId}`,
              event: { ...event, ...written },
            })
            return json({ ok: true, workerId, kind, ...written })
          }

          appendSwarmMemoryEvent({
            workerId,
            missionId,
            assignmentId,
            type: eventType,
            summary: summary || `${eventType} event`,
            title: typeof body.title === 'string' ? body.title : null,
            event,
          })
          return json({ ok: true, workerId, kind, eventType })
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : 'Failed to write swarm memory' }, { status: 400 })
        }
      },
    },
  },
})
