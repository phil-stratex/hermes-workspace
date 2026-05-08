/**
 * Structured logger.
 *
 * Two outputs:
 *   - stdout (always) — single-line JSON for `docker logs` parsing
 *   - JSONL (level >= warn by default; >= info if HERMES_LOG_INFO_TO_FILE=1)
 *     into `data/global/errors/<YYYY-MM-DD>.jsonl` via error-store
 *
 * Calls are fire-and-forget — `logger.warn(...)` returns void and
 * persists asynchronously. If the persistence layer itself fails (FS
 * full, permission flip, …) we surface to stderr exactly once per
 * call so the operator sees something rather than silent loss; we do
 * NOT recurse back into the logger to avoid infinite loops.
 *
 * Auto-Pull from request-context: whatever `getContext()` returns is
 * merged into the persisted entry. Explicit `ctx.userId` etc. on the
 * call-site overrides that.
 */

import {
  appendErrorEntry,
  type ListFilter,
} from './error-store'
import type {
  BrowserInfo,
  ErrorContext,
  ErrorEntryInput,
  ErrorSource,
  Severity,
} from './error-types'
import { getContext } from './request-context'
import { redact } from './error-redact'

const FILE_LEVEL_DEFAULT: ReadonlyArray<Severity> = ['fatal', 'error', 'warn']
const FILE_LEVEL_WITH_INFO: ReadonlyArray<Severity> = ['fatal', 'error', 'warn', 'info']

function shouldPersist(level: Severity): boolean {
  const allow = process.env.HERMES_LOG_INFO_TO_FILE === '1'
    ? FILE_LEVEL_WITH_INFO
    : FILE_LEVEL_DEFAULT
  return allow.includes(level)
}

export type LogContext = ErrorContext & {
  source?: ErrorSource
  browser?: BrowserInfo
}

function emitStdout(level: Severity, msg: string, ctx: LogContext | undefined, err: Error | undefined): void {
  const reqCtx = getContext()
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg,
    requestId: reqCtx?.requestId ?? null,
    userId: reqCtx?.userId ?? null,
    workspaceId: reqCtx?.workspaceId ?? null,
    route: reqCtx?.route ?? null,
    ...(ctx ? { ctx: redact(ctx) } : {}),
    ...(err ? { error: { name: err.name, message: err.message } } : {}),
  }
  // stdout for docker logs — JSON one-liner
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload))
}

function persist(
  level: Severity,
  msg: string,
  ctx: LogContext | undefined,
  err: Error | undefined,
): void {
  if (!shouldPersist(level)) return
  const reqCtx = getContext()
  const source = (ctx?.source as ErrorSource | undefined) ?? 'backend'
  const browser = ctx?.browser as BrowserInfo | undefined
  // Strip the meta keys before redaction so they don't appear under `context`.
  const userCtx: ErrorContext | undefined = ctx
    ? Object.fromEntries(
        Object.entries(ctx).filter(([k]) => k !== 'source' && k !== 'browser'),
      )
    : undefined
  const input: ErrorEntryInput = {
    level,
    source,
    message: msg,
    stack: err?.stack,
    context: userCtx,
    browser,
    requestId: reqCtx?.requestId ?? null,
    userId: reqCtx?.userId ?? null,
    workspaceId: reqCtx?.workspaceId ?? null,
    route: reqCtx?.route ?? null,
    method: reqCtx?.method ?? null,
    ip: reqCtx?.ip ?? null,
  }
  void appendErrorEntry(input).catch((persistErr: unknown) => {
    // Defensive last-resort. We never recurse into logger here.
    process.stderr.write(
      `[logger] failed to persist (${level}): ${
        persistErr instanceof Error ? persistErr.message : String(persistErr)
      }\n`,
    )
  })
}

function emit(level: Severity, msg: string, ctx?: LogContext, err?: Error): void {
  emitStdout(level, msg, ctx, err)
  persist(level, msg, ctx, err)
}

export const logger = {
  fatal(msg: string, ctx?: LogContext, err?: Error): void {
    emit('fatal', msg, ctx, err)
  },
  error(msg: string, ctx?: LogContext, err?: Error): void {
    emit('error', msg, ctx, err)
  },
  warn(msg: string, ctx?: LogContext, err?: Error): void {
    emit('warn', msg, ctx, err)
  },
  info(msg: string, ctx?: LogContext): void {
    emit('info', msg, ctx, undefined)
  },
  debug(msg: string, ctx?: LogContext): void {
    // Debug: stdout only, never persisted.
    if (process.env.HERMES_LOG_DEBUG === '1') {
      emitStdout('debug', msg, ctx, undefined)
    }
  },
}

/**
 * Re-export a few error-store APIs through the logger module so most
 * callers only import from one place.
 */
export type { ListFilter }
export { appendErrorEntry } from './error-store'
