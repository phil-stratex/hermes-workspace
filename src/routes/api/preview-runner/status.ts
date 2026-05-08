import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { safeErrorMessage } from '../../../server/rate-limit'
import { getPreviewStatus } from '../../../server/project-runner'

export const Route = createFileRoute('/api/preview-runner/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response
        try {
          const url = new URL(request.url)
          const runId = url.searchParams.get('runId')?.trim() || ''
          if (!runId) {
            return json(
              { ok: false, error: 'runId required' },
              { status: 400 },
            )
          }
          const run = await getPreviewStatus(runId)
          return json({ ok: true, run })
        } catch (err) {
          return json(
            { ok: false, error: safeErrorMessage(err) },
            { status: 500 },
          )
        }
      },
    },
  },
})
