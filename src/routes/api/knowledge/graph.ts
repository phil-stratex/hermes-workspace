import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { buildKnowledgeGraph } from '../../../server/knowledge-browser'

export const Route = createFileRoute('/api/knowledge/graph')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response

        try {
          return json(buildKnowledgeGraph())
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to build knowledge graph',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
