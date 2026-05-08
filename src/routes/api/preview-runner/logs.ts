/**
 * Preview-runner logs endpoint.
 *
 * Returns the last N lines of the dev-server log file. The frontend can
 * poll every ~2s for a near-realtime feed. SSE-tail (`tail -f` over a
 * streaming response) is a future improvement once the swarm-exec bridge
 * grows a streaming variant — see project-runner.ts for context.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { safeErrorMessage } from '../../../server/rate-limit'
import { getPreviewLogs } from '../../../server/project-runner'

export const Route = createFileRoute('/api/preview-runner/logs')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const runId = url.searchParams.get('runId')?.trim() || ''
          if (!runId) {
            return json(
              { ok: false, error: 'runId required' },
              { status: 400 },
            )
          }
          const tailParam = url.searchParams.get('tail')
          const tail = tailParam ? Number(tailParam) : 200
          const logs = await getPreviewLogs(
            runId,
            Number.isFinite(tail) && tail > 0 ? tail : 200,
          )
          return json({ ok: true, runId, logs })
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
