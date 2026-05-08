import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { listMemoryFiles } from '../../../server/memory-browser'

export const Route = createFileRoute('/api/memory/list')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response
        // Memory is sourced entirely from local filesystem via memory-browser.ts
        // (reads $HERMES_HOME/MEMORY.md + $HERMES_HOME/memory/ + /memories/). No
        // remote gateway endpoint is required, so no capability gate is needed.
        try {
          return json({ files: listMemoryFiles() })
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to list memory files',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
