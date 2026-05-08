import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'

import { requirePermission, requireUser, requireWorkspaceMember } from '../../server/auth-middleware'
import { appendAuditEvent } from '../../server/audit-log'
import { requireJsonContentType } from '../../server/rate-limit'
import {
  getWorkspaceMeta,
  softDeleteWorkspace,
  updateWorkspaceMeta,
} from '../../server/workspace-store'

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logoUrl: z.string().max(2000).optional(),
  defaultModel: z.string().max(200).optional(),
})

export const Route = createFileRoute('/api/workspaces/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = requireUser(request)
        if (!auth.ok) return auth.response
        const member = requireWorkspaceMember(request, params.id)
        if (!member.ok) return member.response
        const meta = getWorkspaceMeta(params.id)!
        return json({ ok: true, workspace: meta })
      },
      PATCH: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        const guard = requirePermission(request, params.id, 'workspace-settings')
        if (!guard.ok) return guard.response

        const raw = await request.json().catch(() => ({}))
        const parsed = PatchSchema.safeParse(raw)
        if (!parsed.success) {
          return json({ ok: false, error: 'Invalid request' }, { status: 400 })
        }
        const next = await updateWorkspaceMeta(params.id, (current) => {
          if (!current) return null
          return {
            ...current,
            name: parsed.data.name ?? current.name,
            description: parsed.data.description ?? current.description,
            branding: {
              ...current.branding,
              primaryColor: parsed.data.primaryColor ?? current.branding.primaryColor,
              logoUrl: parsed.data.logoUrl ?? current.branding.logoUrl,
            },
            settings: {
              ...current.settings,
              defaultModel: parsed.data.defaultModel ?? current.settings.defaultModel,
            },
          }
        })
        if (!next) return json({ ok: false, error: 'Not found' }, { status: 404 })
        await appendAuditEvent(
          { type: 'workspace', wsId: params.id },
          {
            type: 'workspace_settings_updated',
            userId: guard.value.user.id,
            patch: parsed.data,
          },
        )
        return json({ ok: true, workspace: next })
      },
      // DELETE — soft-delete (D4). Members lose access immediately;
      // a 30-day cron sweep eventually hard-deletes.
      DELETE: async ({ request, params }) => {
        const guard = requirePermission(request, params.id, 'workspace-delete')
        if (!guard.ok) return guard.response
        const next = await softDeleteWorkspace(params.id, guard.value.user.id)
        if (!next) return json({ ok: false, error: 'Not found' }, { status: 404 })
        await appendAuditEvent('global', {
          type: 'workspace_deleted',
          workspaceId: params.id,
          deletedBy: guard.value.user.id,
        })
        return json({ ok: true, deletedAt: next.deletedAt })
      },
    },
  },
})
