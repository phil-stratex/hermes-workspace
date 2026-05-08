/**
 * Workspace session-privacy filter (D1 Hybrid + L6 Type-Brand).
 *
 * Sessions live in two source-of-truths:
 *   - The Hermes Gateway holds the authoritative session state.
 *   - `data/workspaces/<wsId>/sessions-meta.json` carries
 *     workspace-local ownership + share metadata for every session
 *     id the workspace cares about.
 *
 * Default visibility:
 *   - Sessions with no entry in `sessions-meta.json` are treated as
 *     "untagged" — visible to nobody. The workspace migration step
 *     tags every gateway session at boot, so this only happens for
 *     races (gateway has a session that has not yet been recorded
 *     locally) — fail closed.
 *   - Sessions where `mapping[id].ownerId === userId`        → visible
 *   - Sessions where `mapping[id].shared === true`           → visible
 *   - Everything else                                        → hidden
 *
 * The function brands its return type so any endpoint that returns
 * sessions has to go through it — `tsc` rejects raw arrays at the
 * route boundary (Plan-Finding L6).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { _markAsFiltered } from './sessions-types'
import type { FilteredSessions } from './sessions-types'
import { getWorkspaceDir, isValidSlug } from './data-paths'
import { assertSchemaVersion } from './json-schema-version'
import { writeJsonAtomic, withMutex } from './atomic-write'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const SESSIONS_META_SCHEMA_VERSION = 1

export type SessionMetaEntry = {
  ownerId: string
  shared: boolean
  createdAt: string
  lastActivityAt: string
  sharedAt?: string
  sharedBy?: string
  snapshotPath?: string
  snapshotUpdatedAt?: string
  snapshotMessageCount?: number
}

export type SessionsMeta = {
  schemaVersion: 1
  sessions: Record<string, SessionMetaEntry>
}

const EMPTY_META: SessionsMeta = { schemaVersion: 1, sessions: {} }

export function sessionsMetaPath(wsId: string): string {
  return join(getWorkspaceDir(wsId), 'sessions-meta.json')
}

function metaMutex(wsId: string): string {
  return `sessions-meta:${wsId}`
}

export function readSessionsMeta(wsId: string): SessionsMeta {
  if (!isValidSlug(wsId)) {
    throw new Error(`[sessions-privacy] invalid wsId: ${JSON.stringify(wsId)}`)
  }
  const path = sessionsMetaPath(wsId)
  if (!existsSync(path)) return EMPTY_META
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return assertSchemaVersion<SessionsMeta>(raw, 1, path)
  } catch {
    return EMPTY_META
  }
}

export type UpdateSessionsMetaPatch = (current: SessionsMeta) => SessionsMeta

export async function updateSessionsMeta(
  wsId: string,
  patch: UpdateSessionsMetaPatch,
): Promise<SessionsMeta> {
  if (!isValidSlug(wsId)) {
    throw new Error(`[sessions-privacy] invalid wsId: ${JSON.stringify(wsId)}`)
  }
  return withMutex(metaMutex(wsId), async () => {
    const current = readSessionsMeta(wsId)
    const next = patch(current)
    if (next.schemaVersion !== 1) {
      throw new Error(`[sessions-privacy] schemaVersion must remain 1`)
    }
    mkdirSync(dirname(sessionsMetaPath(wsId)), { recursive: true })
    writeJsonAtomic(sessionsMetaPath(wsId), next)
    return next
  })
}

/**
 * Tag a gateway session into a workspace's sessions-meta. No-op when
 * the session id already has an entry. Used by:
 *   - the migration step (tag every existing gateway session to the
 *     migrating user)
 *   - the send-stream route (tag a freshly-created session to its
 *     creator on the first stream chunk)
 */
export async function tagSession(
  wsId: string,
  sessionId: string,
  ownerId: string,
): Promise<void> {
  await updateSessionsMeta(wsId, (current) => {
    if (current.sessions[sessionId]) return current
    const now = new Date().toISOString()
    return {
      schemaVersion: 1,
      sessions: {
        ...current.sessions,
        [sessionId]: {
          ownerId,
          shared: false,
          createdAt: now,
          lastActivityAt: now,
        },
      },
    }
  })
}

export async function recordActivity(
  wsId: string,
  sessionId: string,
): Promise<void> {
  await updateSessionsMeta(wsId, (current) => {
    const entry = current.sessions[sessionId]
    if (!entry) return current
    return {
      schemaVersion: 1,
      sessions: {
        ...current.sessions,
        [sessionId]: { ...entry, lastActivityAt: new Date().toISOString() },
      },
    }
  })
}

// ─── Visibility filter ─────────────────────────────────────────────────

type SessionLike = { key?: string; id?: string; friendlyId?: string }

function sessionId<T extends SessionLike>(s: T): string | null {
  if (typeof s.key === 'string' && s.key.length > 0) return s.key
  if (typeof s.id === 'string' && s.id.length > 0) return s.id
  if (typeof s.friendlyId === 'string' && s.friendlyId.length > 0) return s.friendlyId
  return null
}

/**
 * Returns the subset of `sessions` visible to `userId` in the
 * workspace whose mapping is `meta`. The result is branded so the
 * type system can guarantee a route's return value has been filtered.
 *
 * `userId` of `'*'` (a sentinel) yields the unfiltered list — used
 * exclusively by the admin audit path (`audit-view` action) where we
 * surface every session for forensic review. Routes must explicitly
 * pass a real user id otherwise.
 */
export function filterVisibleSessions<T extends SessionLike>(
  sessions: ReadonlyArray<T>,
  userId: string,
  meta: SessionsMeta,
): FilteredSessions<T> {
  if (userId === '*') return _markAsFiltered(sessions)
  const out: Array<T> = []
  for (const session of sessions) {
    const id = sessionId(session)
    if (id === null) continue
    const entry = meta.sessions[id]
    if (!entry) continue // fail-closed: untagged → invisible
    if (entry.ownerId === userId) {
      out.push(session)
      continue
    }
    if (entry.shared) {
      out.push(session)
      continue
    }
  }
  return _markAsFiltered(out)
}

// ─── Share / Unshare ───────────────────────────────────────────────────

export type ShareSessionInput = {
  wsId: string
  sessionId: string
  sharedBy: string
}

/**
 * Mark a session as workspace-shared. Only the session's current
 * owner (or a workspace admin via the route layer) is allowed to
 * call this — `sharedBy` is recorded for audit. Refuses to share a
 * session that has no entry yet (untagged); caller must `tagSession`
 * first.
 */
export async function shareSession(input: ShareSessionInput): Promise<SessionMetaEntry> {
  const result = await updateSessionsMeta(input.wsId, (current) => {
    const entry = current.sessions[input.sessionId]
    if (!entry) {
      throw new Error(`[sessions-privacy] cannot share untagged session: ${input.sessionId}`)
    }
    if (entry.shared) return current
    return {
      schemaVersion: 1,
      sessions: {
        ...current.sessions,
        [input.sessionId]: {
          ...entry,
          shared: true,
          sharedAt: new Date().toISOString(),
          sharedBy: input.sharedBy,
        },
      },
    }
  })
  return result.sessions[input.sessionId]
}

export async function unshareSession(input: {
  wsId: string
  sessionId: string
}): Promise<SessionMetaEntry> {
  const result = await updateSessionsMeta(input.wsId, (current) => {
    const entry = current.sessions[input.sessionId]
    if (!entry) {
      throw new Error(`[sessions-privacy] session not found: ${input.sessionId}`)
    }
    if (!entry.shared) return current
    const { sharedAt: _sharedAt, sharedBy: _sharedBy, snapshotPath: _snapPath,
            snapshotUpdatedAt: _snapUp, snapshotMessageCount: _snapMc, ...rest } = entry
    void _sharedAt; void _sharedBy; void _snapPath; void _snapUp; void _snapMc
    return {
      schemaVersion: 1,
      sessions: {
        ...current.sessions,
        [input.sessionId]: { ...rest, shared: false },
      },
    }
  })
  return result.sessions[input.sessionId]
}

/**
 * Transfer ownership of every session a user owns in the workspace
 * to another user. Used in the Member-Remove "Sessions übertragen"
 * path (Plan D1).
 */
export async function transferSessionsOwnership(input: {
  wsId: string
  fromUserId: string
  toUserId: string
}): Promise<number> {
  let moved = 0
  await updateSessionsMeta(input.wsId, (current) => {
    const next: Record<string, SessionMetaEntry> = {}
    for (const [sid, entry] of Object.entries(current.sessions)) {
      if (entry.ownerId === input.fromUserId) {
        next[sid] = { ...entry, ownerId: input.toUserId }
        moved++
      } else {
        next[sid] = entry
      }
    }
    return { schemaVersion: 1, sessions: next }
  })
  return moved
}

/**
 * List session ids owned by a user — needed by the member-remove
 * "Sessions löschen" path so the route can call the gateway delete
 * for each one.
 */
export function listSessionsOwnedBy(wsId: string, userId: string): Array<string> {
  const meta = readSessionsMeta(wsId)
  return Object.entries(meta.sessions)
    .filter(([_id, e]) => e.ownerId === userId)
    .map(([id]) => id)
}
