import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { getFileArtifact } from '../../../server/file-artifact-store'

export const Route = createFileRoute('/api/file-artifacts/$artifactId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response

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
