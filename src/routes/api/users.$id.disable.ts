import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import {
  getCurrentUser,
  isMultiTenantAuthEnabled,
  revokeAllUserSessionTokens,
} from '../../server/auth-middleware'
import { appendAuditEvent } from '../../server/audit-log'
import { isValidSlug } from '../../server/data-paths'
import { canDo } from '../../server/permissions'
import { requireJsonContentType } from '../../server/rate-limit'
import { getUserProfile, updateUserProfile } from '../../server/users-store'
import { getMember, listWorkspaces } from '../../server/workspace-store'

export const Route = createFileRoute('/api/users/$id/disable')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isMultiTenantAuthEnabled()) {
          return json({ ok: false, error: 'multi-tenant auth not enabled' }, { status: 412 })
        }
        const actor = getCurrentUser(request)
        if (!actor) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        if (!isValidSlug(params.id)) return json({ ok: false, error: 'Invalid id' }, { status: 400 })
        const target = getUserProfile(params.id)
        if (!target) return json({ ok: false, error: 'Not found' }, { status: 404 })

        let allowed = false
        for (const wsId of listWorkspaces()) {
          if (getMember(wsId, params.id) && canDo(actor.id, wsId, 'members-manage')) {
            allowed = true
            break
          }
        }
        if (!allowed) {
          return json({ ok: false, error: 'Forbidden' }, { status: 403 })
        }

        const updated = await updateUserProfile(params.id, (p) =>
          p ? { ...p, status: 'disabled' as const } : null,
        )
        await revokeAllUserSessionTokens(params.id)
        await appendAuditEvent('global', {
          type: 'user_disabled',
          targetUserId: params.id,
          actorUserId: actor.id,
        })
        return json({ ok: true, profile: { id: params.id, status: updated?.status } })
      },
    },
  },
})
