import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { readPresets } from '../../../server/mcp-presets-store'
import { safeErrorMessage } from '../../../server/rate-limit'

export const Route = createFileRoute('/api/mcp/presets')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response
        try {
          const result = await readPresets()
          // Always 200 — the UI distinguishes user-file/seed/invalid via the
          // `source` field. A 5xx would obscure validation context.
          return json({
            ok: result.source !== 'invalid',
            presets: result.presets,
            source: result.source,
            ...(result.error ? { error: result.error } : {}),
            ...(result.errorPath ? { errorPath: result.errorPath } : {}),
            ...(result.validationErrors
              ? { validationErrors: result.validationErrors }
              : {}),
            ...(result.warnings ? { warnings: result.warnings } : {}),
          })
        } catch (err) {
          console.error('[mcp-presets] read failed:', err)
          return json(
            {
              ok: false,
              presets: [],
              source: 'invalid',
              error: safeErrorMessage(err),
            },
            { status: 200 },
          )
        }
      },
    },
  },
})
