/**
 * Stack-Admin guard for the global error-log.
 *
 * Auto-detect-mode driven by `isMultiTenantAuthEnabled()`:
 *
 *   Pre-Migration  →  any authenticated user (legacy single-PW had no
 *                     userId concept — gating tighter would leave the
 *                     feature unusable for the only operator)
 *   Post-Migration →  only userIds in `data/global/settings.json#stackAdmins`
 *
 * The mode flips deterministically the moment the multi-tenant
 * migration completes. The `boot-state-check.ts` bootstrap step
 * ensures the new mode has at least one stack-admin before locking
 * everyone out — by promoting the oldest workspace owner if the list
 * is empty.
 *
 * `requireStackAdmin(req)` follows the same `RequireResult<T>` pattern
 * as `requirePermission` in `auth-middleware.ts:454-501`.
 */

import {
  getCurrentUser,
  isAuthenticated,
  isMultiTenantAuthEnabled,
} from './auth-middleware'
import { isStackAdmin } from './global-settings'
import type { UserProfile } from './users-store'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

export type StackAdminGuardValue = {
  /** UserProfile in multi-tenant mode, null in legacy single-PW. */
  user: UserProfile | null
  mode: 'legacy' | 'multi-tenant'
}

export type RequireResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response }

/**
 * Boolean flavour — used by sidebar/bell-visibility to decide whether
 * to render the entry. Returns false on any negative without leaking
 * which gate failed.
 */
export function canSeeErrors(req: Request): boolean {
  if (isMultiTenantAuthEnabled()) {
    const user = getCurrentUser(req)
    return user !== null && user.status === 'active' && isStackAdmin(user.id)
  }
  return isAuthenticated(req)
}

/**
 * Result-flavour gate for API handlers. Either returns the user (in
 * multi-tenant) or `null` (in legacy single-PW), or a ready-to-return
 * 401/403 Response.
 *
 * Usage:
 *   const guard = requireStackAdmin(request)
 *   if (!guard.ok) return guard.response
 *   // guard.value.user / guard.value.mode
 */
export function requireStackAdmin(request: Request): RequireResult<StackAdminGuardValue> {
  if (isMultiTenantAuthEnabled()) {
    const user = getCurrentUser(request)
    if (!user) {
      return { ok: false, response: jsonResponse({ ok: false, error: 'Unauthorized' }, 401) }
    }
    if (user.status !== 'active') {
      return {
        ok: false,
        response: jsonResponse(
          { ok: false, error: 'Forbidden', reason: `user-status:${user.status}` },
          403,
        ),
      }
    }
    if (!isStackAdmin(user.id)) {
      return {
        ok: false,
        response: jsonResponse(
          { ok: false, error: 'Forbidden', reason: 'not-stack-admin' },
          403,
        ),
      }
    }
    return { ok: true, value: { user, mode: 'multi-tenant' } }
  }
  if (!isAuthenticated(request)) {
    return { ok: false, response: jsonResponse({ ok: false, error: 'Unauthorized' }, 401) }
  }
  return { ok: true, value: { user: null, mode: 'legacy' } }
}
