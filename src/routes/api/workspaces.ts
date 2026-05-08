import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'

import { requireUser } from '../../server/auth-middleware'
import { appendAuditEvent } from '../../server/audit-log'
import { isValidSlug } from '../../server/data-paths'
import { requireJsonContentType } from '../../server/rate-limit'
import {
  addMember,
  createWorkspace,
  getMember,
  getWorkspaceMeta,
  isWorkspaceActive,
  listWorkspaces,
} from '../../server/workspace-store'

const CreateSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

export const Route = createFileRoute('/api/workspaces')({
  server: {
    handlers: {
      // GET — workspaces the caller is a member of
      GET: async ({ request }) => {
        const auth = requireUser(request)
        if (!auth.ok) return auth.response
        const out: Array<{
          id: string
          name: string
          role: string
          branding: { primaryColor: string; logoUrl?: string }
          deletedAt?: string
        }> = []
        for (const wsId of listWorkspaces()) {
          const meta = getWorkspaceMeta(wsId)
          if (!isWorkspaceActive(meta)) continue
          const member = getMember(wsId, auth.value.id)
          if (!member) continue
          out.push({
            id: wsId,
            name: meta!.name,
            role: member.role,
            branding: meta!.branding,
          })
        }
        return json({ ok: true, workspaces: out })
      },
      // POST — create a new workspace; caller becomes its owner
      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        const auth = requireUser(request)
        if (!auth.ok) return auth.response

        const raw = await request.json().catch(() => ({}))
        const parsed = CreateSchema.safeParse(raw)
        if (!parsed.success) {
          return json({ ok: false, error: 'Invalid request' }, { status: 400 })
        }
        if (!isValidSlug(parsed.data.id)) {
          return json({ ok: false, error: 'Invalid workspace id (slug expected)' }, { status: 400 })
        }

        try {
          const meta = await createWorkspace({
            id: parsed.data.id,
            name: parsed.data.name,
            description: parsed.data.description,
            createdBy: auth.value.id,
            branding: parsed.data.primaryColor
              ? { primaryColor: parsed.data.primaryColor }
              : undefined,
          })
          await addMember({
            wsId: parsed.data.id,
            userId: auth.value.id,
            role: 'owner',
            addedBy: auth.value.id,
          })
          await appendAuditEvent('global', {
            type: 'workspace_created',
            workspaceId: meta.id,
            createdBy: auth.value.id,
          })
          await appendAuditEvent(
            { type: 'workspace', wsId: meta.id },
            { type: 'workspace_created', userId: auth.value.id },
          )
          return json({ ok: true, workspace: meta })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : 'create failed' },
            { status: 400 },
          )
        }
      },
    },
  },
})
