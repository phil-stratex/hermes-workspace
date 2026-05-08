import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import {
  requireJsonContentType,
  safeErrorMessage,
} from '../../../server/rate-limit'
import { stopPreview } from '../../../server/project-runner'

export const Route = createFileRoute('/api/preview-runner/stop')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json().catch(() => ({}))) as {
            runId?: string
          }
          const runId =
            typeof body.runId === 'string' ? body.runId.trim() : ''
          if (!runId) {
            return json(
              { ok: false, error: 'runId required' },
              { status: 400 },
            )
          }
          await stopPreview(runId)
          return json({ ok: true })
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
