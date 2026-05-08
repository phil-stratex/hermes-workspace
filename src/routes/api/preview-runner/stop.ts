import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  requireJsonContentType,
  safeErrorMessage,
} from '../../../server/rate-limit'
import { stopPreview } from '../../../server/project-runner'

export const Route = createFileRoute('/api/preview-runner/stop')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
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
