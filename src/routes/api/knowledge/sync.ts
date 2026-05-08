import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import {
  readKnowledgeBaseConfig,
  type KnowledgeBaseConfig,
} from '../../../server/knowledge-config'
import { syncKnowledgeSource } from '../../../server/knowledge-browser'

export const Route = createFileRoute('/api/knowledge/sync')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response

        // Optional: allow body to override source temporarily for one-shot use
        let config: KnowledgeBaseConfig | null = null
        try {
          const text = await request.text()
          if (text) {
            config = JSON.parse(text)
          }
        } catch {
          // ignore parse errors, use stored config
        }

        if (config) {
          const { writeKnowledgeBaseConfig } = await import(
            '../../../server/knowledge-config'
          )
          writeKnowledgeBaseConfig(config)
        }

        try {
          const result = await syncKnowledgeSource()
          return json(result)
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to sync knowledge source',
            },
            { status: 500 },
          )
        }
      },
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response
        const config = readKnowledgeBaseConfig()
        return json({ source: config.source })
      },
    },
  },
})
