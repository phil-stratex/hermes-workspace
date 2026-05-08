/**
 * `withRequestContext(req, handler)` wraps a route handler so the
 * logger inside it can pull `requestId` / `userId` / `workspaceId` /
 * `route` / `method` / `ip` without each call-site threading them
 * through.
 *
 * Roll-out: new error-tracking routes use this from day one. Existing
 * routes (top-priority `send-stream`, `council`, `swarm-dispatch`,
 * `auth.login`) get migrated in a second wave. Until then their logger
 * calls land with `requestId: null` — still strictly better than the
 * pre-patch `console.warn` which had no correlation at all.
 */

import { randomUUID } from 'node:crypto'

import {
  getActiveWorkspace,
  getCurrentUser,
  getRequestIp,
} from './auth-middleware'
import { runWithContext } from './request-context'

export function withRequestContext<T>(
  request: Request,
  handler: () => Promise<T> | T,
): Promise<T> | T {
  let route: string | null = null
  try {
    route = new URL(request.url).pathname
  } catch {
    route = null
  }
  return runWithContext(
    {
      requestId: randomUUID(),
      userId: getCurrentUser(request)?.id ?? null,
      workspaceId: getActiveWorkspace(request),
      route,
      method: request.method ?? null,
      ip: getRequestIp(request),
    },
    handler,
  )
}
