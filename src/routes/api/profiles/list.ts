import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireActiveWorkspaceMember } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import {
  getActiveProfileName,
  listProfiles,
} from '../../../server/profiles-browser'

export const Route = createFileRoute('/api/profiles/list')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireActiveWorkspaceMember(request)
        if (!auth.ok) return auth.response
        try {
          return json({
            profiles: listProfiles(),
            activeProfile: getActiveProfileName(),
          })
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to list profiles',
              profiles: [],
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
