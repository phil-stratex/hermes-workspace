import path from 'node:path'
import os from 'node:os'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)

const CLAUDE_HOME =
  process.env.HERMES_HOME || process.env.CLAUDE_HOME || path.join(os.homedir(), '.hermes')

export const Route = createFileRoute('/api/paths')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response
        return json({
          ok: true,
          claudeHome: CLAUDE_HOME,
          memoriesDir: path.join(CLAUDE_HOME, 'memories'),
          skillsDir: path.join(CLAUDE_HOME, 'skills'),
        })
      },
    },
  },
})
