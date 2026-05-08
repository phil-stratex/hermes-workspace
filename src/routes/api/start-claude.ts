import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../server/route-auth-helpers'
import { createFileRoute } from '@tanstack/react-router'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { startClaudeAgent } from '../../server/claude-agent'

export const Route = createFileRoute('/api/start-claude')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response

          const result = await startClaudeAgent()
          return json(result, { status: result.ok ? 200 : 500 })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
