/**
 * Append-only, hash-chained JSONL store for error entries.
 *
 * Layout:  data/global/errors/<YYYY-MM-DD>.jsonl
 * One ErrorEntry per line, encoded with sorted-key stable JSON so the
 * hash-chain (`prevHash` → `thisHash`) recomputes deterministically on
 * read. Pattern mirrors `audit-log.ts:97-211` 1:1 — same chain rules,
 * same `withMutex` keying, same `assertSchemaVersion` gate.
 *
 * Auto-dedup (N1): when the LAST entry of today's file shares the
 * `dedupHash` of the new input AND its `ts` (or `lastOccurrenceAt`) is
 * within DEDUP_WINDOW_MS, the file is atomically rewritten with that
 * entry's `occurrences` incremented and `lastOccurrenceAt` set to now.
 * No new line is appended. The hash-chain stays valid because only the
 * tail entry's body changed; we recompute its `thisHash` and the next
 * `appendErrorEntry` will pick up the new tail-hash as `prevHash`.
 *
 * Why "last entry only" instead of "any entry within window": dedup is
 * meant to collapse bursts of identical errors. If a different error
 * landed in between, the burst is over and a fresh entry is the right
 * thing — both for visibility and for keeping the rewrite cost O(1) on
 * the chain instead of O(N) cascading.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

import { withMutex, writeTextAtomic } from './atomic-write'
import { getGlobalDir } from './data-paths'
import { publishErrorEntry } from './error-events'
import { ERROR_ENTRY_SCHEMA_VERSION } from './error-types'
import type { ErrorEntry, ErrorEntryInput, Severity } from './error-types'
import { redact, redactStack } from './error-redact'
import { getContext } from './request-context'

const ZERO_HASH = '0'.repeat(64)
const DEDUP_WINDOW_MS = 60 * 1000

export function getErrorsDir(): string {
  return join(getGlobalDir(), 'errors')
}

function getErrorsFile(dateISO?: string): string {
  const day = (dateISO ?? new Date().toISOString()).slice(0, 10)
  return join(getErrorsDir(), `${day}.jsonl`)
}

export function todayUTC(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function mutexKey(date: string): string {
  return `errors:${date}`
}

// ─── Stable JSON + hash helpers (mirrors audit-log) ─────────────────────

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    const out: Record<string, unknown> = {}
    for (const k of keys) out[k] = sortKeysDeep((value as Record<string, unknown>)[k])
    return out
  }
  return value
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value))
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function computeEntryHash(entryWithoutThisHash: Omit<ErrorEntry, 'thisHash'>): string {
  return sha256(stableStringify(entryWithoutThisHash))
}

/**
 * Stable identifier for "the same kind of error" — drives dedup. Pulls
 * `route` / `userId` so a partner-tenant 404 doesn't dedup with an
 * owner-tenant 404 on a different route.
 */
function computeDedupHash(entry: {
  level: Severity
  source: string
  message: string
  route?: string | null
  userId?: string | null
  stack?: string
}): string {
  const stackTop = (entry.stack ?? '').split('\n').slice(0, 3).join('\n')
  const stackTopHash = stackTop ? sha256(stackTop) : ''
  return sha256(
    stableStringify({
      level: entry.level,
      source: entry.source,
      message: entry.message,
      route: entry.route ?? null,
      userId: entry.userId ?? null,
      stackTopHash,
    }),
  )
}

// ─── File I/O ───────────────────────────────────────────────────────────

function readEntriesSync(file: string): Array<ErrorEntry> {
  if (!existsSync(file)) return []
  const content = readFileSync(file, 'utf8')
  const out: Array<ErrorEntry> = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed) as ErrorEntry)
    } catch {
      // skip corrupt lines — chain validation will surface them later
    }
  }
  return out
}

function lastEntrySync(file: string): ErrorEntry | null {
  const entries = readEntriesSync(file)
  return entries.length > 0 ? entries[entries.length - 1] : null
}

// ─── Append ─────────────────────────────────────────────────────────────

/**
 * Append (or dedup-update) one entry. The function returns the entry as
 * it was persisted — including chain fields — and is the only way new
 * lines reach the JSONL.
 *
 * Auto-pulls `requestId` / `userId` / `workspaceId` / `route` / `method`
 * / `ip` from AsyncLocalStorage when the input doesn't supply them, so
 * a `logger.warn(msg, ctx)` inside an HTTP handler picks up correlation
 * for free.
 */
export async function appendErrorEntry(input: ErrorEntryInput): Promise<ErrorEntry> {
  const ctx = getContext()
  // Resolve context — explicit input wins over AsyncLocalStorage.
  const resolvedRoute = input.route ?? ctx?.route ?? null
  const resolvedUserId = input.userId ?? ctx?.userId ?? null
  const resolvedWorkspaceId = input.workspaceId ?? ctx?.workspaceId ?? null
  const resolvedRequestId = input.requestId ?? ctx?.requestId ?? null
  const resolvedMethod = input.method ?? ctx?.method ?? null
  const resolvedIp = input.ip ?? ctx?.ip ?? null

  // Redact before persistence. Stack uses isStack:true (email scrub +
  // stack-aware truncation); ctx and browser go through the body path.
  const redactedStack = redactStack(input.stack)
  const redactedContext =
    input.context !== undefined ? (redact(input.context) as Record<string, unknown>) : undefined
  const redactedBrowser =
    input.browser !== undefined
      ? (redact(input.browser) as ErrorEntryInput['browser'])
      : undefined
  const redactedMessage = redact(input.message) as string

  const date = todayUTC()
  const file = getErrorsFile(date)

  return withMutex(mutexKey(date), async () => {
    mkdirSync(dirname(file), { recursive: true })

    const dedupHash = computeDedupHash({
      level: input.level,
      source: input.source,
      message: redactedMessage,
      route: resolvedRoute,
      userId: resolvedUserId,
      stack: redactedStack,
    })

    const last = lastEntrySync(file)
    const now = new Date()
    const lastTs = last
      ? new Date(last.lastOccurrenceAt ?? last.ts).getTime()
      : 0
    const withinWindow = last && now.getTime() - lastTs <= DEDUP_WINDOW_MS

    let result: ErrorEntry
    if (last && last.dedupHash === dedupHash && withinWindow) {
      // Dedup hit — modify the tail entry in-place.
      const occurrences = (last.occurrences ?? 1) + 1
      const updated: Omit<ErrorEntry, 'thisHash'> = {
        ...last,
        occurrences,
        lastOccurrenceAt: now.toISOString(),
        // Re-run the redaction with the freshest field values — should
        // be idempotent, but keep things explicit.
        message: redactedMessage,
        stack: redactedStack,
        context: redactedContext,
        browser: redactedBrowser,
      }
      // Strip the old thisHash before recomputing — sortKeysDeep would
      // otherwise include the stale hash in the digest.
      const { thisHash: _oldHash, ...body } = updated as ErrorEntry
      void _oldHash
      const newHash = computeEntryHash(body as Omit<ErrorEntry, 'thisHash'>)
      const final: ErrorEntry = { ...(body as Omit<ErrorEntry, 'thisHash'>), thisHash: newHash }

      // Rewrite the file atomically. Cost is O(N) but only triggers on
      // a tail-burst where every dupe is back-to-back; the normal case
      // (mixed errors) hits the append path.
      const allEntries = readEntriesSync(file)
      allEntries[allEntries.length - 1] = final
      const content = allEntries.map((e) => JSON.stringify(e)).join('\n') + '\n'
      writeTextAtomic(file, content)
      result = final
      publishErrorEntry(result)
      return result
    }

    // No dedup — normal append.
    const prevHash = last?.thisHash ?? ZERO_HASH
    const body: Omit<ErrorEntry, 'thisHash'> = {
      schemaVersion: ERROR_ENTRY_SCHEMA_VERSION,
      id: '', // filled in below
      ts: now.toISOString(),
      level: input.level,
      source: input.source,
      message: redactedMessage,
      stack: redactedStack,
      dedupHash,
      requestId: resolvedRequestId,
      userId: resolvedUserId,
      workspaceId: resolvedWorkspaceId,
      route: resolvedRoute,
      method: resolvedMethod,
      ip: resolvedIp,
      context: redactedContext,
      browser: redactedBrowser,
      prevHash,
    }
    const thisHash = computeEntryHash(body)
    body.id = thisHash.slice(0, 16)
    // id changed → recompute hash so the digest covers the final id.
    const finalBody: Omit<ErrorEntry, 'thisHash'> = body
    const finalHash = computeEntryHash(finalBody)
    const entry: ErrorEntry = { ...finalBody, thisHash: finalHash }

    appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
    result = entry
    publishErrorEntry(result)
    return result
  })
}

// ─── Read API ───────────────────────────────────────────────────────────

export type ListFilter = {
  /** ISO date or millis. Inclusive lower bound. */
  since?: string | number
  level?: Array<Severity>
  source?: Array<string>
  userId?: string
  workspaceId?: string
  /** Substring match against `message` and `route`. Case-insensitive. */
  search?: string
  limit?: number
  offset?: number
  /**
   * Default false — `source: 'test'` is hidden unless explicitly
   * requested via `includeTest: true`.
   */
  includeTest?: boolean
}

function listDateFiles(): Array<{ date: string; path: string }> {
  const dir = getErrorsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
    .map((n) => ({ date: n.slice(0, 10), path: join(dir, n) }))
    .sort((a, b) => (a.date < b.date ? 1 : -1)) // newest first
}

export function listErrors(filter: ListFilter = {}): {
  total: number
  entries: Array<ErrorEntry>
} {
  const files = listDateFiles()
  const limit = Math.max(0, Math.min(filter.limit ?? 100, 1000))
  const offset = Math.max(0, filter.offset ?? 0)
  const sinceMs =
    typeof filter.since === 'string'
      ? new Date(filter.since).getTime()
      : typeof filter.since === 'number'
        ? filter.since
        : 0
  const search = filter.search?.trim().toLowerCase() ?? ''

  const matched: Array<ErrorEntry> = []
  let total = 0
  for (const { path } of files) {
    const entries = readEntriesSync(path)
    // newest first within file
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]
      if (!matchEntry(e, filter, sinceMs, search)) continue
      total++
      if (total <= offset) continue
      if (matched.length < limit) matched.push(e)
    }
  }
  return { total, entries: matched }
}

function matchEntry(
  e: ErrorEntry,
  filter: ListFilter,
  sinceMs: number,
  search: string,
): boolean {
  if (sinceMs > 0 && new Date(e.ts).getTime() < sinceMs) return false
  if (filter.level && filter.level.length > 0 && !filter.level.includes(e.level)) return false
  if (filter.source && filter.source.length > 0 && !filter.source.includes(e.source)) return false
  if (!filter.includeTest && e.source === 'test') return false
  if (filter.userId && e.userId !== filter.userId) return false
  if (filter.workspaceId && e.workspaceId !== filter.workspaceId) return false
  if (search) {
    const hay = `${e.message} ${e.route ?? ''}`.toLowerCase()
    if (!hay.includes(search)) return false
  }
  return true
}

export function getErrorById(id: string): ErrorEntry | null {
  const files = listDateFiles()
  for (const { path } of files) {
    const entries = readEntriesSync(path)
    for (const e of entries) {
      if (e.id === id) return e
    }
  }
  return null
}

/**
 * Returns all entries within ±windowMs of the given requestId's first
 * entry. Default window: ±5s. Used by the `/errors/:id` detail view to
 * show "Related Logs".
 */
export function findRelatedByRequestId(
  requestId: string,
  windowMs: number = 5000,
): Array<ErrorEntry> {
  if (!requestId) return []
  const files = listDateFiles()
  const matches: Array<ErrorEntry> = []
  for (const { path } of files) {
    for (const e of readEntriesSync(path)) {
      if (e.requestId === requestId) matches.push(e)
    }
  }
  if (matches.length === 0) return []
  const anchor = new Date(matches[0].ts).getTime()
  // Wider net within `windowMs` even if requestId differs — e.g. when
  // we want "logs near this request" that aren't exact-id matches.
  const out: Array<ErrorEntry> = []
  for (const { path } of files) {
    for (const e of readEntriesSync(path)) {
      const dt = Math.abs(new Date(e.ts).getTime() - anchor)
      if (dt <= windowMs) out.push(e)
    }
  }
  return out.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
}

export type HealthSummary = {
  windowMs: number
  counts: Record<Severity, number>
  total: number
}

export function getHealthSummary(windowMs: number = 60 * 60 * 1000): HealthSummary {
  const cutoff = Date.now() - windowMs
  const counts: Record<Severity, number> = {
    fatal: 0,
    error: 0,
    warn: 0,
    info: 0,
    debug: 0,
  }
  let total = 0
  for (const { path } of listDateFiles()) {
    for (const e of readEntriesSync(path)) {
      const ts = new Date(e.ts).getTime()
      if (ts < cutoff) continue
      counts[e.level] = (counts[e.level] ?? 0) + 1
      total++
    }
  }
  return { windowMs, counts, total }
}

// ─── Chain validation (analog audit-log.readAuditChain) ─────────────────

export type ChainResult = {
  entries: Array<ErrorEntry>
  brokenAt: number | null
  breakReason?: string
}

export function validateChain(dateISO: string): ChainResult {
  const file = getErrorsFile(dateISO)
  if (!existsSync(file)) return { entries: [], brokenAt: null }
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim().length > 0)
  const entries: Array<ErrorEntry> = []
  let brokenAt: number | null = null
  let breakReason: string | undefined
  let expectedPrev = ZERO_HASH

  for (let i = 0; i < lines.length; i++) {
    let parsed: ErrorEntry
    try {
      parsed = JSON.parse(lines[i]) as ErrorEntry
    } catch {
      brokenAt ??= i
      breakReason ??= `parse error at line ${i + 1}`
      continue
    }
    entries.push(parsed)
    if (brokenAt !== null) continue
    if (parsed.schemaVersion !== ERROR_ENTRY_SCHEMA_VERSION) {
      brokenAt = i
      breakReason = `schema version ${parsed.schemaVersion} at line ${i + 1}`
      continue
    }
    if (parsed.prevHash !== expectedPrev) {
      brokenAt = i
      breakReason = `prevHash mismatch at line ${i + 1}: expected ${expectedPrev}, got ${parsed.prevHash}`
      continue
    }
    const { thisHash, ...body } = parsed
    const recomputed = computeEntryHash(body as Omit<ErrorEntry, 'thisHash'>)
    if (recomputed !== thisHash) {
      brokenAt = i
      breakReason = `thisHash mismatch at line ${i + 1}`
      continue
    }
    expectedPrev = parsed.thisHash
  }
  return brokenAt !== null ? { entries, brokenAt, breakReason } : { entries, brokenAt: null }
}

// ─── Test-only helpers ──────────────────────────────────────────────────

/** Test-only: erase the JSONL for a specific date. */
export function _deleteErrorsFileForTests(dateISO: string): void {
  const file = getErrorsFile(dateISO)
  if (existsSync(file)) unlinkSync(file)
}

export { ZERO_HASH as _ZERO_HASH_FOR_TESTS }
