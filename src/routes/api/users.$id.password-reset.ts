import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { canDo } from '../../server/permissions'
import {
  getCurrentUser,
  isMultiTenantAuthEnabled,
  revokeAllUserSessionTokens,
} from '../../server/auth-middleware'
import { generateTempPassword, hashPassword } from '../../server/auth-passwords'
import { appendAuditEvent } from '../../server/audit-log'
import { isValidSlug } from '../../server/data-paths'
import { createTempPwReset } from '../../server/pw-resets-store'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'
import {
  getUserProfile,
  setPasswordHash,
  updateUserProfile,
} from '../../server/users-store'
import { getMember, listWorkspaces } from '../../server/workspace-store'

/**
 * POST /api/users/$id/password-reset
 *
 * Admin-triggered temporary password generation. The actor (caller)
 * must be admin or owner in at least one workspace that the target
 * user is also a member of (`user-pw-reset` action). Returns the
 * plaintext temp PW EXACTLY ONCE in the response — caller is expected
 * to forward it out-of-band (Slack/in-person).
 *
 * Side-effects:
 *   - bcrypt hash of the temp PW is written to `auth/password-hash.txt`
 *   - `mustChangePassword: true` is set on the target profile
 *   - all of the target's existing session tokens are revoked
 *   - a pw-reset record is persisted (for audit/forensics)
 *   - audit event lands in `data/global/audit/`
 */
export const Route = createFileRoute('/api/users/$id/password-reset')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isMultiTenantAuthEnabled()) {
          return json({ ok: false, error: 'multi-tenant auth not enabled' }, { status: 412 })
        }
        const actor = getCurrentUser(request)
        if (!actor) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })

        if (!isValidSlug(params.id)) {
          return json({ ok: false, error: 'Invalid user id' }, { status: 400 })
        }
        const target = getUserProfile(params.id)
        if (!target) return json({ ok: false, error: 'User not found' }, { status: 404 })

        // Authority check: actor must be admin/owner in some workspace
        // where the target is a member. Iterate target's memberships.
        let allowed = false
        let viaWorkspace: string | null = null
        for (const wsId of listWorkspacesContaining(params.id)) {
          if (canDo(actor.id, wsId, 'user-pw-reset')) {
            allowed = true
            viaWorkspace = wsId
            break
          }
        }
        if (!allowed) {
          return json({ ok: false, error: 'Forbidden', reason: 'no-shared-workspace' }, { status: 403 })
        }

        const ip = getClientIp(request)
        if (!rateLimit(`pw-reset:${actor.id}:${ip}`, 5, 60 * 60 * 1000)) {
          return rateLimitResponse()
        }

        // 1) Generate temp PW (plain) and hash
        const tempPw = generateTempPassword()
        const hash = await hashPassword(tempPw)

        // 2) Persist
        await setPasswordHash(params.id, hash)
        await updateUserProfile(params.id, (p) =>
          p ? { ...p, mustChangePassword: true } : null,
        )
        await revokeAllUserSessionTokens(params.id)
        const reset = await createTempPwReset({
          userId: params.id,
          triggeredById: actor.id,
        })

        // 3) Audit
        await appendAuditEvent('global', {
          type: 'pw_reset_temp',
          targetUserId: params.id,
          actorUserId: actor.id,
          viaWorkspace,
          resetToken: reset.token,
          ip,
        })

        return json({
          ok: true,
          tempPassword: tempPw,
          expiresAt: reset.expiresAt,
          warning: 'This password is shown ONCE — copy it now and forward securely.',
        })
      },
    },
  },
})

function listWorkspacesContaining(userId: string): Array<string> {
  const out: Array<string> = []
  for (const wsId of listWorkspaces()) {
    if (getMember(wsId, userId)) out.push(wsId)
  }
  return out
}
