/**
 * Type definitions for the error-tracking subsystem.
 *
 * Lives separate from `error-store.ts` so other modules (logger,
 * error-acl, builder-brief, UI) can import the shape without pulling
 * in the storage implementation.
 *
 * `lastOccurrenceAt` is set whenever `occurrences > 1` so the UI can
 * distinguish "old problem still happening" from "old problem that
 * resolved itself a while ago" — without it, a 247-occurrence dedup
 * cluster shown with the first-seen `ts` would mislead an operator.
 */

export const ERROR_ENTRY_SCHEMA_VERSION = 1

export type Severity = 'fatal' | 'error' | 'warn' | 'info' | 'debug'

export type ErrorSource =
  | 'backend'
  | 'frontend'
  | 'gateway'
  | 'swarm'
  | 'federation'
  | 'auth'
  | 'storage'
  | 'migration'
  | 'test'
  | 'unknown'

export type ErrorContext = Record<string, unknown>

export type BrowserInfo = {
  userAgent?: string
  url?: string
  viewport?: { width: number; height: number }
}

/**
 * Caller-supplied input. The storage layer fills in the
 * derived/system fields (`id`, `ts`, `dedupHash`, `prevHash`,
 * `thisHash`, `occurrences`, `lastOccurrenceAt`).
 */
export type ErrorEntryInput = {
  level: Severity
  source: ErrorSource
  message: string
  stack?: string
  context?: ErrorContext
  browser?: BrowserInfo
  requestId?: string | null
  userId?: string | null
  workspaceId?: string | null
  route?: string | null
  method?: string | null
  ip?: string | null
}

/**
 * Persisted shape — every JSONL line in `data/global/errors/<date>.jsonl`
 * conforms to this type.
 */
export type ErrorEntry = {
  schemaVersion: 1
  /** Stable id (sha256 of body, prefix). Used by `/api/errors/:id`. */
  id: string
  /** ISO timestamp of FIRST occurrence — never moves on dedup hits. */
  ts: string
  /**
   * ISO timestamp of MOST RECENT occurrence (N1). Set whenever
   * `occurrences > 1`. Lets the UI render "first 3h ago / last 5min ago / 247×".
   */
  lastOccurrenceAt?: string
  /** Auto-incremented when the same `dedupHash` arrives within 60s. */
  occurrences?: number
  level: Severity
  source: ErrorSource
  message: string
  /** Already redacted + truncated by the storage layer. */
  stack?: string
  /** Hash over `(level, source, message, route, userId, stackTopHash)`. */
  dedupHash: string
  /** AsyncLocalStorage-pulled. */
  requestId?: string | null
  userId?: string | null
  workspaceId?: string | null
  route?: string | null
  method?: string | null
  ip?: string | null
  context?: ErrorContext
  browser?: BrowserInfo
  /** Hash-chain — points at the previous entry of the same day-file. */
  prevHash: string
  /** SHA-256 of stable-stringify of the entry minus this field. */
  thisHash: string
}
