import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { describeBootState } from '../../server/boot-state-check'
import {
  isMultiTenantAuthEnabled,
  isPasswordProtectionEnabled,
} from '../../server/auth-middleware'

/**
 * GET /api/setup-status — public, no auth.
 *
 * Frontend uses this to decide which surface to render before any
 * authenticated state is known:
 *
 *   { mode: 'fresh-stack' }       → SetupWizard
 *   { mode: 'multi-tenant' }      → LoginScreen (email + password)
 *   { mode: 'legacy' }            → LoginScreen (single password)
 *   { mode: 'inconsistent' }      → blocked banner with operator hint
 *
 * No user-specific information is leaked — the only signal returned
 * is the high-level boot state.
 */
export const Route = createFileRoute('/api/setup-status')({
  server: {
    handlers: {
      GET: async () => {
        const state = describeBootState()
        if (state.state === 'fresh-stack') {
          return json({ ok: true, mode: 'fresh-stack' as const })
        }
        if (state.state === 'inconsistent') {
          return json(
            {
              ok: true,
              mode: 'inconsistent' as const,
              hint: 'docker exec <container> tsx scripts/admin/repair-marker.ts',
            },
            { status: 200 },
          )
        }
        if (isMultiTenantAuthEnabled()) {
          return json({ ok: true, mode: 'multi-tenant' as const })
        }
        // Legacy mode (pre-migration single-PW)
        return json({
          ok: true,
          mode: 'legacy' as const,
          authRequired: isPasswordProtectionEnabled(),
        })
      },
    },
  },
})
