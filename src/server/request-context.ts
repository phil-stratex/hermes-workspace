/**
 * AsyncLocalStorage-based request context. Lets the logger pull
 * `requestId` / `userId` / `workspaceId` / `route` without every
 * call-site having to thread them through.
 *
 * `runWithContext(ctx, fn)` is wrapped around request handlers (via
 * `request-middleware.ts:withRequestContext`). Inside the handler tree
 * any `getContext()` call sees the same ctx — including across
 * `await`s, since AsyncLocalStorage propagates across the
 * Promise/microtask boundary.
 *
 * Outside a request, `getContext()` returns null; the logger then
 * persists entries with `requestId: null`. That is fine for boot-time
 * Errors (retention-cron, bootstrap) — they're not request-scoped.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export type RequestContext = {
  requestId: string
  userId: string | null
  workspaceId: string | null
  route: string | null
  method: string | null
  ip: string | null
}

const storage = new AsyncLocalStorage<RequestContext>()

export function runWithContext<T>(
  ctx: RequestContext,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return storage.run(ctx, fn)
}

export function getContext(): RequestContext | null {
  return storage.getStore() ?? null
}

/** Test-only inspector. */
export function _hasActiveContextForTests(): boolean {
  return storage.getStore() !== undefined
}
