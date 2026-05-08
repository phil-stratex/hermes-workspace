/**
 * Hash-chained, append-only audit log.
 *
 * Every event carries `prevHash` (= `thisHash` of the previous entry)
 * and `thisHash` (= sha256 over the rest of the entry, with sorted-key
 * stable JSON serialisation). The first entry of a file uses
 * `prevHash = '0' * 64`. A reader recomputes both hashes for every line
 * and reports the index of the first break — so post-hoc tampering or
 * accidental corruption is visible to operators (`AuditViewer` flags
 * `chain_break_detected`).
 *
 * Two scopes:
 *   - `global` → `<dataDir>/global/audit/<YYYY-MM-DD>.jsonl`. Used for
 *     pre-auth events (failed logins with IP), CLI-triggered actions,
 *     workspace lifecycle, migration markers.
 *   - `{ type: 'workspace', wsId }` → `<workspaceDir>/audit/...`. Used
 *     for member changes, owner handover, federation sync, etc.
 *
 * Writes are serialised through `withMutex` keyed on the file path so
 * concurrent appends from multiple routes can't tear a line.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

import { withMutex } from './atomic-write'
import { getGlobalDir, getWorkspaceDir, isValidSlug } from './data-paths'

export const AUDIT_SCHEMA_VERSION = 1
const ZERO_HASH = '0'.repeat(64)

export type AuditScope = 'global' | { type: 'workspace'; wsId: string }

export type AuditEventInput = {
  type: string
  [key: string]: unknown
}

export type AuditEntry = {
  schemaVersion: 1
  ts: string
  type: string
  prevHash: string
  thisHash: string
  [key: string]: unknown
}

function scopeLabel(scope: AuditScope): string {
  return scope === 'global' ? 'global' : `workspace:${scope.wsId}`
}

function getAuditDir(scope: AuditScope): string {
  if (scope === 'global') return join(getGlobalDir(), 'audit')
  if (!isValidSlug(scope.wsId)) {
    throw new Error(`[audit] invalid wsId: ${JSON.stringify(scope.wsId)}`)
  }
  return join(getWorkspaceDir(scope.wsId), 'audit')
}

function getAuditFile(scope: AuditScope, dateISO?: string): string {
  const day = (dateISO ?? new Date().toISOString()).slice(0, 10)
  return join(getAuditDir(scope), `${day}.jsonl`)
}

function mutexKey(scope: AuditScope, file: string): string {
  return `audit:${scopeLabel(scope)}:${file}`
}

/**
 * Stable JSON: object keys sorted alphabetically at every level.
 * Without this, hash recomputation on read could disagree with the
 * write-side hash for objects whose JSON serialisation depends on
 * insertion order.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value))
}

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

function computeEntryHash(entryWithoutThisHash: Omit<AuditEntry, 'thisHash'>): string {
  return createHash('sha256').update(stableStringify(entryWithoutThisHash)).digest('hex')
}

function readLastHashFromFile(file: string): string {
  if (!existsSync(file)) return ZERO_HASH
  const content = readFileSync(file, 'utf8')
  // Walk from the end to find the last non-empty, parseable line.
  const lines = content.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.length === 0) continue
    try {
      const parsed = JSON.parse(line) as Partial<AuditEntry>
      if (typeof parsed.thisHash === 'string' && parsed.thisHash.length === 64) {
        return parsed.thisHash
      }
    } catch {
      // skip corrupt line
    }
  }
  return ZERO_HASH
}

/**
 * Append a single audit event. The function returns the entry as it
 * was persisted (with `prevHash`, `thisHash`, `ts`, `schemaVersion`
 * filled in). Caller-supplied fields cannot override the chain fields
 * — system keys are written last in the spread.
 */
export async function appendAuditEvent(
  scope: AuditScope,
  event: AuditEventInput,
): Promise<AuditEntry> {
  if (scope !== 'global' && !isValidSlug(scope.wsId)) {
    throw new Error(`[audit] invalid wsId: ${JSON.stringify(scope.wsId)}`)
  }
  if (typeof event.type !== 'string' || event.type.length === 0) {
    throw new Error(`[audit] event.type required`)
  }
  const file = getAuditFile(scope)
  return withMutex(mutexKey(scope, file), async () => {
    const prevHash = readLastHashFromFile(file)
    const body: Omit<AuditEntry, 'thisHash'> = {
      ...event,
      schemaVersion: AUDIT_SCHEMA_VERSION,
      ts: new Date().toISOString(),
      type: event.type,
      prevHash,
    }
    const thisHash = computeEntryHash(body)
    // TS spread+index-signature inference loses the named fields, so cast.
    const entry = { ...body, thisHash } as AuditEntry
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
    return entry
  })
}

export type AuditChainResult = {
  entries: Array<AuditEntry>
  /** Index of the first entry that fails chain validation; null if intact */
  brokenAt: number | null
  /** Reason for the break, for the UI alert */
  breakReason?: string
}

/**
 * Read all entries from a single day file and validate the hash chain.
 * `brokenAt` is the index of the first entry that either:
 *   - failed JSON parse,
 *   - has a wrong `schemaVersion`,
 *   - has a `prevHash` that doesn't match the previous entry's `thisHash`,
 *   - or has a `thisHash` that doesn't match recomputation.
 */
export function readAuditChain(scope: AuditScope, dateISO?: string): AuditChainResult {
  const file = getAuditFile(scope, dateISO)
  if (!existsSync(file)) return { entries: [], brokenAt: null }
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim().length > 0)
  const entries: Array<AuditEntry> = []
  let brokenAt: number | null = null
  let breakReason: string | undefined
  let expectedPrev = ZERO_HASH

  for (let i = 0; i < lines.length; i++) {
    let parsed: AuditEntry
    try {
      parsed = JSON.parse(lines[i]) as AuditEntry
    } catch {
      brokenAt ??= i
      breakReason ??= `parse error at line ${i + 1}`
      continue
    }
    entries.push(parsed)
    if (brokenAt !== null) continue // once broken, stop validating

    if (parsed.schemaVersion !== AUDIT_SCHEMA_VERSION) {
      brokenAt = i
      breakReason = `schema version ${parsed.schemaVersion} at line ${i + 1}, expected ${AUDIT_SCHEMA_VERSION}`
      continue
    }
    if (parsed.prevHash !== expectedPrev) {
      brokenAt = i
      breakReason = `prevHash mismatch at line ${i + 1}: expected ${expectedPrev}, got ${parsed.prevHash}`
      continue
    }
    const { thisHash, ...body } = parsed
    const recomputed = computeEntryHash(body)
    if (recomputed !== thisHash) {
      brokenAt = i
      breakReason = `thisHash mismatch at line ${i + 1}: recomputed ${recomputed}, stored ${thisHash}`
      continue
    }
    expectedPrev = parsed.thisHash
  }
  return brokenAt !== null
    ? { entries, brokenAt, breakReason }
    : { entries, brokenAt: null }
}

/**
 * List all audit JSONL files for a scope, sorted ascending by date.
 * Used by the AuditViewer to render a per-day timeline.
 */
export function listAuditFiles(scope: AuditScope): Array<string> {
  const dir = getAuditDir(scope)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => n.endsWith('.jsonl'))
    .sort()
}
