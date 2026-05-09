import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import { createKanbanCard, getKanbanBackendMeta, listKanbanCards, updateKanbanCard } from '../../server/kanban-backend'

// `acceptanceCriteria` arrives from the UI as a single newline-separated
// string but the kanban store expects `string[]`. Accept either form and
// normalize to array before passing to the store layer.
const CreateCardSchema = z.object({
  title: z.string().trim().min(1).max(200),
  spec: z.string().trim().max(5000).optional().default(''),
  acceptanceCriteria: z
    .union([z.string().trim().max(5000), z.array(z.string().trim().max(500))])
    .optional()
    .default(''),
  assignedWorker: z.string().trim().max(120).optional().nullable(),
  reviewer: z.string().trim().max(120).optional().nullable(),
  status: z.enum(['backlog', 'ready', 'running', 'review', 'blocked', 'done']).optional().default('backlog'),
  missionId: z.string().trim().max(200).optional().nullable(),
  reportPath: z.string().trim().max(500).optional().nullable(),
  createdBy: z.string().trim().max(120).optional().default('aurora'),
})

function normalizeAcceptanceCriteria(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean)
  if (typeof value === 'string')
    return value.split('\n').map((line) => line.trim()).filter(Boolean)
  return []
}

const UpdateCardSchema = CreateCardSchema.partial().extend({
  id: z.string().trim().min(1),
})

export const Route = createFileRoute('/api/swarm-kanban')({
  server: {
    handlers: {
      GET: async () => {
        return json({
          ok: true,
          cards: await listKanbanCards(),
          backend: getKanbanBackendMeta(),
        })
      },
      POST: async ({ request }) => {
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
        }
        const parsed = CreateCardSchema.safeParse(body)
        if (!parsed.success) {
          return json({ ok: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') }, { status: 400 })
        }
        const card = await createKanbanCard({
          ...parsed.data,
          acceptanceCriteria: normalizeAcceptanceCriteria(parsed.data.acceptanceCriteria),
        })
        return json({ ok: true, card, backend: getKanbanBackendMeta() })
      },
      PATCH: async ({ request }) => {
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
        }
        const parsed = UpdateCardSchema.safeParse(body)
        if (!parsed.success) {
          return json({ ok: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') }, { status: 400 })
        }
        const { id, acceptanceCriteria, ...rest } = parsed.data
        const updates = {
          ...rest,
          ...(acceptanceCriteria !== undefined
            ? { acceptanceCriteria: normalizeAcceptanceCriteria(acceptanceCriteria) }
            : {}),
        }
        const card = await updateKanbanCard(id, updates)
        if (!card) return json({ ok: false, error: 'Card not found' }, { status: 404 })
        return json({ ok: true, card, backend: getKanbanBackendMeta() })
      },
    },
  },
})
