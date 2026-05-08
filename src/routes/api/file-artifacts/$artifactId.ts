import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getFileArtifact } from '../../../server/file-artifact-store'

export const Route = createFileRoute('/api/file-artifacts/$artifactId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const artifact = getFileArtifact(params.artifactId)
        if (!artifact) {
          return json(
            { ok: false, error: 'Artifact not found' },
            { status: 404 },
          )
        }
        return json({ ok: true, artifact })
      },
    },
  },
})
