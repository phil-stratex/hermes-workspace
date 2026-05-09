import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { readContextUsage } from '@/server/context-usage'

export const Route = createFileRoute('/api/context-usage')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response

        const url = new URL(request.url)
        const sessionId =
          url.searchParams.get('sessionId')?.trim() ||
          url.searchParams.get('sessionKey')?.trim() ||
          ''

        // Synthetic placeholders: brand-new chat ('new') or the gateway's
        // 'main' bucket key. No real conversation yet — short-circuit.
        if (sessionId === 'new' || sessionId === 'main') {
          return json({
            ok: true,
            contextPercent: 0,
            maxTokens: 0,
            usedTokens: 0,
            model: '',
            staticTokens: 0,
            conversationTokens: 0,
          })
        }

        const snapshot = await readContextUsage(sessionId)
        return json(snapshot)
      },
    },
  },
})
