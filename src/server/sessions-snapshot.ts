/**
 * Lazy session-snapshot store (D1 + R6 + N7).
 *
 * When a workspace member shares a session, we don't mirror it live
 * — we write a one-shot JSON snapshot of the session's current state
 * to `data/workspaces/<wsId>/sessions/shared/<sid>.json`. The
 * snapshot is what Federation can sync (it never touches the
 * gateway directly) and what non-owner viewers see.
 *
 * The snapshot can age out: if the owner keeps chatting after
 * sharing, `lastActivityAt` advances past `snapshotUpdatedAt`.
 * `ensureFreshSnapshot()` lazily refreshes from the gateway when:
 *
 *   - the snapshot is older than 10 minutes AND
 *   - `lastActivityAt > snapshotUpdatedAt` (there are new messages)
 *
 * To prevent a thundering herd of 50 viewers all triggering a
 * gateway-roundtrip at once, the refresh is serialised through
 * `withMutex(\`snapshot:\${wsId}:\${sid}\`)` — first viewer pays the
 * cost, the rest wait on the same promise. The mutex map self-cleans
 * via Plan-Finding N7 so unique keys per session don't grow it
 * unboundedly.
 *
 * On gateway failure the function returns the stale snapshot with
 * a `stale: true` flag so the UI can render a banner without
 * breaking the read.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { withMutex, writeJsonAtomic } from './atomic-write'
import { getWorkspaceDir, isValidSlug } from './data-paths'
import { readSessionsMeta, sessionsMetaPath, updateSessionsMeta } from './sessions-privacy'
import type { SessionMetaEntry } from './sessions-privacy'

export const SNAPSHOT_FRESHNESS_MS = 10 * 60 * 1000

export type SessionSnapshot = {
  schemaVersion: 1
  sessionId: string
  ownerId: string
  capturedAt: string
  messageCount: number
  /** Loose-typed payload — caller (route) decides what to capture. */
  payload: unknown
}

export type SessionSnapshotResult = {
  snapshot: SessionSnapshot | null
  stale: boolean
  refreshed: boolean
}

export function snapshotPath(wsId: string, sessionId: string): string {
  return join(getWorkspaceDir(wsId), 'sessions', 'shared', `${sessionId}.json`)
}

function readSnapshotFile(path: string): SessionSnapshot | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SessionSnapshot
  } catch {
    return null
  }
}

/**
 * Function the caller (route) provides to fetch the canonical session
 * payload from the gateway. Kept abstract so this module doesn't
 * directly depend on `claude-api.ts` — that lets the unit tests mock
 * the fetcher without spinning up a fake gateway.
 */
export type SnapshotFetcher = (sessionId: string) => Promise<{
  payload: unknown
  messageCount: number
}>

function isFresh(meta: SessionMetaEntry, snapshot: SessionSnapshot | null): boolean {
  if (!snapshot) return false
  if (!meta.snapshotUpdatedAt) return false
  const snapshotAge = Date.now() - new Date(meta.snapshotUpdatedAt).getTime()
  if (snapshotAge < SNAPSHOT_FRESHNESS_MS) return true
  // Older than 10min: only refresh if there is genuinely new activity.
  const lastActivity = new Date(meta.lastActivityAt).getTime()
  const snapshotAt = new Date(meta.snapshotUpdatedAt).getTime()
  return lastActivity <= snapshotAt
}

/**
 * Read or refresh the snapshot for a shared session. Refusal modes:
 *   - session is not shared → returns `{ snapshot: null, stale: false, refreshed: false }`
 *   - mapping doesn't have an entry → same
 *   - gateway fetch fails on stale data → returns the stale snapshot
 *     with `stale: true`
 */
export async function ensureFreshSnapshot(opts: {
  wsId: string
  sessionId: string
  fetcher: SnapshotFetcher
}): Promise<SessionSnapshotResult> {
  if (!isValidSlug(opts.wsId)) {
    throw new Error(`[sessions-snapshot] invalid wsId: ${JSON.stringify(opts.wsId)}`)
  }
  return withMutex(`snapshot:${opts.wsId}:${opts.sessionId}`, async () => {
    // Re-read meta INSIDE the mutex so a queued caller sees the
    // results of the in-progress refresh that just settled. Without
    // this, every queued caller would still believe the snapshot is
    // stale and re-fire the fetcher (Plan-Finding R6 thundering-herd).
    const meta = readSessionsMeta(opts.wsId)
    const entry = meta.sessions[opts.sessionId]
    if (!entry || !entry.shared) {
      return { snapshot: null, stale: false, refreshed: false }
    }
    const path = snapshotPath(opts.wsId, opts.sessionId)
    const existing = readSnapshotFile(path)
    if (isFresh(entry, existing)) {
      return { snapshot: existing, stale: false, refreshed: false }
    }
    // Stale or missing — refresh from gateway. On failure, return stale.
    try {
      const fresh = await opts.fetcher(opts.sessionId)
      const snapshot: SessionSnapshot = {
        schemaVersion: 1,
        sessionId: opts.sessionId,
        ownerId: entry.ownerId,
        capturedAt: new Date().toISOString(),
        messageCount: fresh.messageCount,
        payload: fresh.payload,
      }
      mkdirSync(dirname(path), { recursive: true })
      writeJsonAtomic(path, snapshot)
      await updateSessionsMeta(opts.wsId, (current) => {
        const cur = current.sessions[opts.sessionId]
        if (!cur) return current
        return {
          schemaVersion: 1,
          sessions: {
            ...current.sessions,
            [opts.sessionId]: {
              ...cur,
              snapshotPath: `sessions/shared/${opts.sessionId}.json`,
              snapshotUpdatedAt: snapshot.capturedAt,
              snapshotMessageCount: fresh.messageCount,
            },
          },
        }
      })
      return { snapshot, stale: false, refreshed: true }
    } catch (err) {
      console.warn(
        `[sessions-snapshot] refresh failed for ${opts.wsId}/${opts.sessionId}:`,
        err instanceof Error ? err.message : err,
      )
      // Existing snapshot returned with stale flag, never throws.
      return { snapshot: existing, stale: true, refreshed: false }
    }
  })
}

/**
 * Force-write a snapshot ignoring freshness. Used by the share-route
 * so the new snapshot exists immediately when the user shares the
 * session — no first-read latency.
 */
export async function captureInitialSnapshot(opts: {
  wsId: string
  sessionId: string
  fetcher: SnapshotFetcher
}): Promise<SessionSnapshot> {
  if (!isValidSlug(opts.wsId)) {
    throw new Error(`[sessions-snapshot] invalid wsId: ${JSON.stringify(opts.wsId)}`)
  }
  return withMutex(`snapshot:${opts.wsId}:${opts.sessionId}`, async () => {
    const meta = readSessionsMeta(opts.wsId)
    const entry = meta.sessions[opts.sessionId]
    if (!entry) {
      throw new Error(`[sessions-snapshot] cannot snapshot untagged session: ${opts.sessionId}`)
    }
    const fresh = await opts.fetcher(opts.sessionId)
    const path = snapshotPath(opts.wsId, opts.sessionId)
    const snapshot: SessionSnapshot = {
      schemaVersion: 1,
      sessionId: opts.sessionId,
      ownerId: entry.ownerId,
      capturedAt: new Date().toISOString(),
      messageCount: fresh.messageCount,
      payload: fresh.payload,
    }
    mkdirSync(dirname(path), { recursive: true })
    writeJsonAtomic(path, snapshot)
    await updateSessionsMeta(opts.wsId, (current) => {
      const cur = current.sessions[opts.sessionId]
      if (!cur) return current
      return {
        schemaVersion: 1,
        sessions: {
          ...current.sessions,
          [opts.sessionId]: {
            ...cur,
            snapshotPath: `sessions/shared/${opts.sessionId}.json`,
            snapshotUpdatedAt: snapshot.capturedAt,
            snapshotMessageCount: fresh.messageCount,
          },
        },
      }
    })
    void sessionsMetaPath
    return snapshot
  })
}
