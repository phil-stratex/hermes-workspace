import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireWorkspaceAction } from '../../server/route-auth-helpers'
import { isMultiTenantAuthEnabled } from '../../server/auth-middleware'
import {
  checkSessionVisibility,
  readSessionsMeta,
} from '../../server/sessions-privacy'
import { getLocalSession } from '../../server/local-session-store'
import { readContextUsage } from '@/server/context-usage'

export const Route = createFileRoute('/api/context-usage')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = requireWorkspaceAction(request, 'chat')
        if (!guard.ok) return guard.response

        const url = new URL(request.url)
        const sessionId = url.searchParams.get('sessionId')?.trim() || ''

        // @stratex-patch: multi-tenant privacy check — same leak as
        // session-status.ts. Empty/synthetic sessionId skips the check
        // (the readContextUsage fallback returns an empty snapshot
        // anyway). Local sessions live in the portable store and are
        // workspace-dir-scoped, not sessions-meta-tagged — skip them too.
        if (
          sessionId &&
          isMultiTenantAuthEnabled() &&
          guard.value.user &&
          guard.value.wsId &&
          !getLocalSession(sessionId)
        ) {
          const meta = readSessionsMeta(guard.value.wsId)
          const visibility = checkSessionVisibility(
            guard.value.user.id,
            sessionId,
            meta,
          )
          if (visibility.kind === 'not-found') {
            return json({ ok: false, error: 'Not found' }, { status: 404 })
          }
          if (visibility.kind === 'forbidden') {
            return json({ ok: false, error: 'Forbidden' }, { status: 403 })
          }
        }

        const snapshot = await readContextUsage(sessionId)
        return json(snapshot)
      },
    },
  },
})
