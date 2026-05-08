import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { searchSwarmMemory } from '../../../server/swarm-memory'

export const Route = createFileRoute('/api/swarm-memory/search')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response
        const url = new URL(request.url)
        const workerId = url.searchParams.get('workerId')
        const query = url.searchParams.get('q') || url.searchParams.get('query') || ''
        const scopeParam = url.searchParams.get('scope')
        const scope = scopeParam === 'shared' || scopeParam === 'all' ? scopeParam : 'worker'
        const rawLimit = Number(url.searchParams.get('limit') || 10)
        const limit = Number.isFinite(rawLimit) ? rawLimit : 10
        try {
          return json({ results: searchSwarmMemory({ workerId, query, scope, limit }) })
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : 'Failed to search swarm memory' }, { status: 400 })
        }
      },
    },
  },
})
