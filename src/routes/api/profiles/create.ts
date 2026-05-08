import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { createProfile } from '../../../server/profiles-browser'
import { requireJsonContentType } from '../../../server/rate-limit'

export const Route = createFileRoute('/api/profiles/create')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json()) as {
            name?: string
            cloneFrom?: string
            model?: string
            provider?: string
          }
          return json({
            ok: true,
            profile: createProfile(body.name || '', {
              cloneFrom: body.cloneFrom,
              model: body.model,
              provider: body.provider,
            }),
          })
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to create profile',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
