import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireWorkspaceAction } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { updateProfileConfig } from '../../../server/profiles-browser'
import { requireJsonContentType } from '../../../server/rate-limit'

export const Route = createFileRoute('/api/profiles/update')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = requireWorkspaceAction(request, 'roster-edit')
        if (!auth.ok) return auth.response
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json()) as {
            name?: string
            patch?: Record<string, unknown>
          }
          if (!body.patch || typeof body.patch !== 'object') {
            return json({ error: 'patch is required' }, { status: 400 })
          }
          const profile = updateProfileConfig(body.name || '', body.patch)
          return json({ ok: true, profile })
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to update profile',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
