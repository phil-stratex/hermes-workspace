import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireActiveWorkspaceMember } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { readProfile } from '../../../server/profiles-browser'
import { isLegacyDataWorkspace } from '../../../server/workspace-data-scope'

export const Route = createFileRoute('/api/profiles/read')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireActiveWorkspaceMember(request)
        if (!auth.ok) return auth.response
        if (!isLegacyDataWorkspace(auth.value.wsId)) {
          return json({ profile: null })
        }
        try {
          const url = new URL(request.url)
          const name = (url.searchParams.get('name') || '').trim() || 'default'
          return json({ profile: readProfile(name) })
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to read profile',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
