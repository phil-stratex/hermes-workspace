import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { startClaudeAgent } from '../../server/claude-agent'

export const Route = createFileRoute('/api/start-agent')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response

        const result = await startClaudeAgent()
        return json(result, { status: result.ok ? 200 : 500 })
      },
    },
  },
})
