import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { requireUser, requireWorkspaceMember } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import { updateUserProfile } from '../../server/users-store'

/**
 * POST /api/workspaces/$id/switch — set the caller's defaultWorkspaceId
 * to $id. Used by the WorkspaceSwitcher in the chat sidebar.
 */
export const Route = createFileRoute('/api/workspaces/$id/switch')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        const auth = requireUser(request)
        if (!auth.ok) return auth.response
        const member = requireWorkspaceMember(request, params.id)
        if (!member.ok) return member.response
        await updateUserProfile(auth.value.id, (p) =>
          p ? { ...p, defaultWorkspaceId: params.id } : null,
        )
        return json({ ok: true, activeWorkspaceId: params.id })
      },
    },
  },
})
