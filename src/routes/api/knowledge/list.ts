import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import {
  knowledgeRootExists,
  listKnowledgePages,
} from '../../../server/knowledge-browser'
import { readKnowledgeBaseConfig } from '../../../server/knowledge-config'

export const Route = createFileRoute('/api/knowledge/list')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response

        try {
          const config = readKnowledgeBaseConfig()
          const source = config.source
          const exists = knowledgeRootExists()
          return json({
            pages: exists ? listKnowledgePages() : [],
            exists,
            source,
          })
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to list knowledge pages',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
