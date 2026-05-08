import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import {
  requireJsonContentType,
  safeErrorMessage,
} from '../../../server/rate-limit'
import { startPreview } from '../../../server/project-runner'

export const Route = createFileRoute('/api/preview-runner/start')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json().catch(() => ({}))) as {
            projectDirRelative?: string
            sessionId?: string
          }
          const projectDirRelative =
            typeof body.projectDirRelative === 'string'
              ? body.projectDirRelative.trim()
              : ''
          if (!projectDirRelative) {
            return json(
              { ok: false, error: 'projectDirRelative required' },
              { status: 400 },
            )
          }
          const run = await startPreview({
            projectDirRelative,
            sessionId:
              typeof body.sessionId === 'string' ? body.sessionId : undefined,
          })
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
