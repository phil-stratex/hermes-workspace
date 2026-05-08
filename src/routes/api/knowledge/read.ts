import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { readKnowledgePage } from '../../../server/knowledge-browser'

export const Route = createFileRoute('/api/knowledge/read')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response

        const url = new URL(request.url)
        const pathParam = url.searchParams.get('path') || ''

        try {
          const { meta, content, backlinks } = readKnowledgePage(pathParam)
          return json({ page: meta, content, backlinks })
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to read knowledge page'
          const status =
            /not allowed|outside knowledge root|required|traversal/i.test(
              message,
            )
              ? 400
              : /ENOENT/.test(message)
                ? 404
                : 500
          return json({ error: message }, { status })
        }
      },
    },
  },
})
