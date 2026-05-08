/**
 * Adapter helpers that bridge the legacy `isAuthenticated`-based route
 * style and the new `requireUser` / `requirePermission` helpers.
 *
 * Background — Plan A.3.1: 146 existing routes used a single
 * `if (!isAuthenticated(request)) return 401`. Migrating each one to a
 * fully-qualified `requirePermission(req, wsId, action)` would touch
 * every file. Instead, this module gives them a single drop-in helper
 * that:
 *
 *   1. In multi-tenant mode (post-migration): resolves the caller via
 *      `requireUser` and, when an `action` is requested, gates the
 *      active-workspace via `requirePermission`. Returns the user +
 *      wsId for routes that want to scope reads/writes.
 *
 *   2. In legacy mode (pre-migration single-PW): falls back to the old
 *      boolean check. Returns user=null + wsId=null so callers know
 *      no identity is available.
 *
 * Plan-Finding L5: existing routes can migrate one at a time. Routes
 * that don't care about workspace-scoping use `requireAuthenticated`;
 * routes that need a permission gate use `requireWorkspaceAction`.
 */

import {
  getActiveWorkspace,
  isMultiTenantAuthEnabled,
  isAuthenticated,
  requirePermission,
  requireUser,
  requireWorkspaceMember,
} from './auth-middleware'
import type { UserProfile } from './users-store'
import type { Action } from './permissions'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

export type AuthValue = {
  /** UserProfile in multi-tenant mode, null in legacy. */
  user: UserProfile | null
  /** Active workspace id in multi-tenant mode, null in legacy. */
  wsId: string | null
  /** True when multi-tenant auth is active. */
  multiTenant: boolean
}

export type RequireResult<T> = { ok: true; value: T } | { ok: false; response: Response }

/**
 * The minimum gate any authenticated route needs. In multi-tenant mode
 * this maps to `requireUser`; in legacy mode it maps to the old
 * `isAuthenticated` boolean check. Returns 401 either way on failure.
 */
export function requireAuthenticated(request: Request): RequireResult<AuthValue> {
  if (isMultiTenantAuthEnabled()) {
    const auth = requireUser(request)
    if (!auth.ok) return auth
    return {
      ok: true,
      value: {
        user: auth.value,
        wsId: getActiveWorkspace(request),
        multiTenant: true,
      },
    }
  }
  if (!isAuthenticated(request)) {
    return { ok: false, response: jsonResponse({ ok: false, error: 'Unauthorized' }, 401) }
  }
  return { ok: true, value: { user: null, wsId: null, multiTenant: false } }
}

/**
 * Authenticated + active-workspace + `action` permission. In legacy
 * mode degrades to a basic auth check (no workspace context exists)
 * and the action argument is ignored — that matches the spec's
 * behaviour during the transition.
 */
export function requireWorkspaceAction(
  request: Request,
  action: Action,
): RequireResult<AuthValue> {
  if (isMultiTenantAuthEnabled()) {
    const wsId = getActiveWorkspace(request)
    if (!wsId) {
      // User logged in but has no active workspace assigned. Surface
      // 409 so the UI can route them to a workspace-picker instead of
      // a generic 401.
      return {
        ok: false,
        response: jsonResponse(
          { ok: false, error: 'No active workspace', hint: 'POST /api/workspaces/<id>/switch' },
          409,
        ),
      }
    }
    const guard = requirePermission(request, wsId, action)
    if (!guard.ok) return guard
    return {
      ok: true,
      value: {
        user: guard.value.user,
        wsId: guard.value.wsId,
        multiTenant: true,
      },
    }
  }
  // Legacy: just need to be authenticated.
  return requireAuthenticated(request)
}

/**
 * Authenticated + active-workspace (no action gate). Used for routes
 * that want every member of the active workspace to be able to read,
 * but no member of a different workspace to peek in.
 */
export function requireActiveWorkspaceMember(request: Request): RequireResult<AuthValue> {
  if (isMultiTenantAuthEnabled()) {
    const wsId = getActiveWorkspace(request)
    if (!wsId) {
      return {
        ok: false,
        response: jsonResponse(
          { ok: false, error: 'No active workspace', hint: 'POST /api/workspaces/<id>/switch' },
          409,
        ),
      }
    }
    const guard = requireWorkspaceMember(request, wsId)
    if (!guard.ok) return guard
    return {
      ok: true,
      value: {
        user: guard.value.user,
        wsId: guard.value.wsId,
        multiTenant: true,
      },
    }
  }
  return requireAuthenticated(request)
}
