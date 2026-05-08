/**
 * Federation Sync-Engine (Plan B.2).
 *
 * Two-phase protocol:
 *
 *   1. **Diff** — compute the change-set between local and remote
 *      workspace tree, group as `inItems` (remote→local), `outItems`
 *      (local→remote — informational; the actual outbound apply
 *      happens on the *peer* side when *they* run their own apply
 *      against us), and `conflicts` (both sides changed since the
 *      last common point). Pure function from the inputs — no I/O
 *      beyond the local FS read and the supplied `mcpClient.call`.
 *
 *   2. **Apply** — given a list of explicit `selectiveItems`, write
 *      each accepted item to the workspace tree. Skips conflicts
 *      that haven't been resolved. Audit-events per item + summary.
 *
 * Conflict detection (Plan-Finding AK28 — time-skew-robust):
 *   We do NOT use wall-clock comparison. A path is in conflict iff
 *   BOTH the local hash AND the remote hash differ from a stored
 *   `lastSeen.<path>` baseline (see `peer.lastSync.baseline`). On
 *   the first sync where no baseline exists yet, any divergence is
 *   flagged as a conflict so the operator chooses explicitly. After
 *   apply, the baseline is updated to the post-apply hash for every
 *   path that successfully moved.
 *
 * Mass-delete protection (Plan B.5):
 *   - `massInDelete`  flag set when incoming tombstones > 50 OR
 *                     > 30% of the local pool (pool-min 10).
 *   - `massOutDelete` symmetric for outgoing.
 *
 * Hardcoded filter (Plan B.5):
 *   - sessions/<userId>/         NEVER synced (we don't even ask
 *                                the remote about user-private dirs)
 *   - members.json, peers.json   NEVER synced
 *   - data/users/                NEVER touched
 *   The MCP server already enforces this on the *remote* side; the
 *   engine enforces it on the *local* apply path so a buggy remote
 *   can't push us into writing somewhere we shouldn't.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

import { getWorkspaceDir, isValidSlug } from './data-paths'
import { writeJsonAtomic } from './atomic-write'
import { resolveSafe } from './federation-mcp-server'
import type { ServerContext } from './federation-mcp-server'
import { emitFederationEvent } from './federation-audit'
import type { FederationMcpClient, RpcResponse } from './federation-mcp-client'
import type { SyncedType } from './federation-peers-store'

export const SYNC_BASELINE_SCHEMA_VERSION = 1
export const MASS_DELETE_COUNT_THRESHOLD = 50
export const MASS_DELETE_PERCENT_THRESHOLD = 0.3
export const MASS_DELETE_POOL_MIN = 10

export type ItemKind = 'memory' | 'skill' | 'session-snapshot'

export type DiffOp = 'add' | 'update' | 'delete'

export type DiffItem = {
  kind: ItemKind
  /** Workspace-relative path: `memories/note.md`, `skills/<name>/SKILL.md`, `sessions/shared/<id>.json`. */
  path: string
  /** What would happen on local if the operator accepts this item. */
  op: DiffOp
  remoteSha256?: string
  localSha256?: string
}

export type DiffConflict = {
  kind: ItemKind
  path: string
  localSha256: string
  remoteSha256: string
}

export type DiffWarnings = {
  massInDelete: boolean
  massOutDelete: boolean
  detail: {
    inDeleteCount: number
    outDeleteCount: number
    inPoolSize: number
    outPoolSize: number
  }
}

export type DiffResult = {
  inItems: ReadonlyArray<DiffItem>
  outItems: ReadonlyArray<DiffItem>
  conflicts: ReadonlyArray<DiffConflict>
  warnings: DiffWarnings
}

/** Persisted hash baseline: per path, the SHA256 from the last
 * successful sync. Stored under `federation/peers-baselines/<peerId>.json`. */
export type SyncBaseline = {
  schemaVersion: 1
  peerId: string
  paths: Record<string, string> // path → sha256
  updatedAt: string
}

function baselinePath(wsId: string, peerId: string): string {
  return join(getWorkspaceDir(wsId), 'federation', 'peers-baselines', `${peerId}.json`)
}

export function readBaseline(wsId: string, peerId: string): SyncBaseline {
  const path = baselinePath(wsId, peerId)
  if (!existsSync(path)) {
    return { schemaVersion: 1, peerId, paths: {}, updatedAt: new Date().toISOString() }
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as SyncBaseline
    if (raw.schemaVersion !== 1) throw new Error('schema mismatch')
    return raw
  } catch {
    return { schemaVersion: 1, peerId, paths: {}, updatedAt: new Date().toISOString() }
  }
}

function writeBaseline(wsId: string, baseline: SyncBaseline): void {
  const path = baselinePath(wsId, baseline.peerId)
  mkdirSync(dirname(path), { recursive: true })
  writeJsonAtomic(path, baseline)
}

// ─── Local read (mirrors what the peer's MCP-server sees of us) ─────

type Pool = {
  paths: Map<string, string> // path → sha256
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function readLocalMemories(wsId: string): Pool {
  const ctx: ServerContext = { workspaceId: wsId, workspaceRoot: getWorkspaceDir(wsId) }
  const root = join(ctx.workspaceRoot, 'memories')
  const paths = new Map<string, string>()
  if (!existsSync(root)) return { paths }
  walkMd(ctx, root, 'memories', paths)
  return { paths }
}

export function readLocalSkills(wsId: string): Pool {
  const root = join(getWorkspaceDir(wsId), 'skills')
  const paths = new Map<string, string>()
  if (!existsSync(root)) return { paths }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillFile = join(root, entry.name, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    const content = readFileSync(skillFile, 'utf8')
    paths.set(`skills/${entry.name}/SKILL.md`, sha256(content))
  }
  return { paths }
}

export function readLocalSessionSnapshots(wsId: string): Pool {
  const root = join(getWorkspaceDir(wsId), 'sessions', 'shared')
  const paths = new Map<string, string>()
  if (!existsSync(root)) return { paths }
  for (const entry of readdirSync(root)) {
    if (!entry.endsWith('.json')) continue
    const target = join(root, entry)
    try {
      const content = readFileSync(target, 'utf8')
      paths.set(`sessions/shared/${entry}`, sha256(content))
    } catch {
      // skip torn snapshots
    }
  }
  return { paths }
}

function walkMd(
  ctx: ServerContext,
  absDir: string,
  relPrefix: string,
  out: Map<string, string>,
): void {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const absChild = join(absDir, entry.name)
    const relChild = `${relPrefix}/${entry.name}`
    if (entry.isDirectory()) {
      try {
        resolveSafe(ctx, relChild)
      } catch {
        continue
      }
      walkMd(ctx, absChild, relChild, out)
      continue
    }
    if (!entry.isFile()) continue
    if (entry.name.endsWith('.md.deleted')) {
      // Tombstones — the path is the would-be live one, not the
      // tombstone itself.
      const livePath = relChild.replace(/\.md\.deleted$/, '.md')
      out.set(livePath + '#tombstone', '')
      continue
    }
    if (!entry.name.endsWith('.md')) continue
    const content = readFileSync(absChild, 'utf8')
    out.set(relChild, sha256(content))
  }
}

// ─── Remote read (via MCP client) ──────────────────────────────────

type RemoteList = {
  memories: Map<string, string>     // path → sha256
  skills: Map<string, string>
  sessionSnapshots: Map<string, string>
}

function unwrap<T>(res: RpcResponse<T>): T {
  if (!res.ok) throw new Error(`peer error ${res.error.code}: ${res.error.message}`)
  return res.result
}

export async function readRemote(client: FederationMcpClient): Promise<RemoteList> {
  const memories = unwrap(await client.call<{ files: Array<{ path: string; sha256: string }> }>('list_memories'))
  const skills = unwrap(await client.call<{ skills: Array<{ name: string; sha256: string }> }>('list_skills'))
  const sessionSnapshots = unwrap(await client.call<{ sessions: Array<{ id: string; sha256: string }> }>('list_session_snapshots'))

  const m = new Map<string, string>()
  for (const f of memories.files) m.set(f.path, f.sha256)
  const sk = new Map<string, string>()
  for (const s of skills.skills) sk.set(`skills/${s.name}/SKILL.md`, s.sha256)
  const ss = new Map<string, string>()
  for (const s of sessionSnapshots.sessions) ss.set(`sessions/shared/${s.id}.json`, s.sha256)
  return { memories: m, skills: sk, sessionSnapshots: ss }
}

// ─── Diff ──────────────────────────────────────────────────────────

export type ComputeDiffOpts = {
  wsId: string
  peerId: string
  syncedTypes: ReadonlyArray<SyncedType>
  /** Inject the remote-list reader for tests; defaults to live MCP client. */
  remote: RemoteList
}

export function computeDiff(opts: ComputeDiffOpts): DiffResult {
  if (!isValidSlug(opts.wsId)) throw new Error(`invalid wsId: ${opts.wsId}`)

  const baseline = readBaseline(opts.wsId, opts.peerId)
  const inItems: Array<DiffItem> = []
  const outItems: Array<DiffItem> = []
  const conflicts: Array<DiffConflict> = []

  let inDeleteCount = 0
  let outDeleteCount = 0
  let inPoolSize = 0
  let outPoolSize = 0

  function diffPool(kind: ItemKind, local: Pool, remote: Map<string, string>): void {
    inPoolSize += remote.size
    outPoolSize += local.paths.size
    const seenPaths = new Set<string>([...local.paths.keys(), ...remote.keys()])
    for (const path of seenPaths) {
      // Skip tombstone markers in the local pool — they're encoded
      // as `<path>#tombstone` and represent intentional deletes.
      if (path.endsWith('#tombstone')) continue
      const tombstoneKey = `${path}#tombstone`
      const localTombstoned = local.paths.has(tombstoneKey)
      const localHash = local.paths.get(path)
      const remoteHash = remote.get(path)
      const baselineHash = baseline.paths[path]

      // Both present
      if (localHash && remoteHash) {
        if (localHash === remoteHash) continue
        if (!baselineHash) {
          // First-time encounter on both sides with different content → conflict
          conflicts.push({ kind, path, localSha256: localHash, remoteSha256: remoteHash })
          continue
        }
        const localChanged = baselineHash !== localHash
        const remoteChanged = baselineHash !== remoteHash
        if (localChanged && remoteChanged) {
          conflicts.push({ kind, path, localSha256: localHash, remoteSha256: remoteHash })
        } else if (remoteChanged) {
          inItems.push({ kind, path, op: 'update', remoteSha256: remoteHash, localSha256: localHash })
        } else if (localChanged) {
          outItems.push({ kind, path, op: 'update', remoteSha256: remoteHash, localSha256: localHash })
        }
        continue
      }
      // Remote-only — incoming add (or remote deleted on us if we tombstoned)
      if (!localHash && remoteHash) {
        if (localTombstoned) {
          // We tombstoned, remote has it — this is an outgoing delete.
          outItems.push({ kind, path, op: 'delete', remoteSha256: remoteHash })
          outDeleteCount++
        } else {
          inItems.push({ kind, path, op: 'add', remoteSha256: remoteHash })
        }
        continue
      }
      // Local-only — outgoing add (or remote tombstoned and we still have it → incoming delete)
      if (localHash && !remoteHash) {
        // We can't see remote tombstones via the MCP tools (they
        // only list live paths). When the baseline knows the path
        // was there last sync but remote no longer has it, that's
        // an incoming delete.
        if (baselineHash) {
          inItems.push({ kind, path, op: 'delete', localSha256: localHash })
          inDeleteCount++
        } else {
          outItems.push({ kind, path, op: 'add', localSha256: localHash })
        }
      }
    }
  }

  if (opts.syncedTypes.includes('memories')) {
    diffPool('memory', readLocalMemories(opts.wsId), opts.remote.memories)
  }
  if (opts.syncedTypes.includes('skills')) {
    diffPool('skill', readLocalSkills(opts.wsId), opts.remote.skills)
  }
  if (opts.syncedTypes.includes('sessions-shared')) {
    diffPool('session-snapshot', readLocalSessionSnapshots(opts.wsId), opts.remote.sessionSnapshots)
  }

  const warnings = computeMassDeleteWarnings(inDeleteCount, outDeleteCount, inPoolSize, outPoolSize)

  return { inItems, outItems, conflicts, warnings }
}

export function computeMassDeleteWarnings(
  inDeleteCount: number,
  outDeleteCount: number,
  inPoolSize: number,
  outPoolSize: number,
): DiffWarnings {
  const inPoolForRatio = Math.max(inPoolSize, MASS_DELETE_POOL_MIN)
  const outPoolForRatio = Math.max(outPoolSize, MASS_DELETE_POOL_MIN)
  const massInDelete =
    inDeleteCount > MASS_DELETE_COUNT_THRESHOLD
    || inDeleteCount / inPoolForRatio > MASS_DELETE_PERCENT_THRESHOLD
  const massOutDelete =
    outDeleteCount > MASS_DELETE_COUNT_THRESHOLD
    || outDeleteCount / outPoolForRatio > MASS_DELETE_PERCENT_THRESHOLD
  return {
    massInDelete,
    massOutDelete,
    detail: { inDeleteCount, outDeleteCount, inPoolSize, outPoolSize },
  }
}

// ─── Apply ─────────────────────────────────────────────────────────

const HARDCODED_DENY_PREFIXES: ReadonlyArray<string> = [
  'sessions/' /* user-private */,
  'members.json',
  'meta.json',
  'sessions-meta.json',
  'federation/',
  'audit/',
  'worker-profiles/',
]

const HARDCODED_DENY_EXACT_DIRS: ReadonlyArray<string> = [
  'sessions/shared',
]

function isPathPermittedForApply(path: string): boolean {
  // Allow exactly the three sync surfaces:
  //   memories/...    (markdown)
  //   skills/<name>/SKILL.md
  //   sessions/shared/<id>.json
  if (path.startsWith('memories/') && (path.endsWith('.md') || path.endsWith('.md.deleted'))) {
    return true
  }
  if (path.startsWith('skills/') && path.endsWith('/SKILL.md')) {
    return true
  }
  if (path.startsWith('sessions/shared/') && path.endsWith('.json')) {
    return true
  }
  return false
}

export type SelectiveItem = {
  path: string
  /** Resolution for conflicts. Otherwise the engine picks based on the diff. */
  resolve?: 'local' | 'remote'
  /** Hash of the remote content the operator just saw — used to refuse stale plans. */
  remoteSha256?: string
}

export type ApplyOpts = {
  wsId: string
  peerId: string
  diff: DiffResult
  selective: ReadonlyArray<SelectiveItem>
  /** MCP client — used to fetch the actual remote content for in-items. */
  fetchRemoteContent: (path: string) => Promise<string>
  actorUserId: string
}

export type ApplyResult = {
  applied: { add: number; update: number; delete: number }
  skipped: Array<{ path: string; reason: string }>
  conflictsResolved: number
}

export async function applyDiff(opts: ApplyOpts): Promise<ApplyResult> {
  if (!isValidSlug(opts.wsId)) throw new Error(`invalid wsId: ${opts.wsId}`)
  const result: ApplyResult = {
    applied: { add: 0, update: 0, delete: 0 },
    skipped: [],
    conflictsResolved: 0,
  }
  const wsRoot = getWorkspaceDir(opts.wsId)
  const ctx: ServerContext = { workspaceId: opts.wsId, workspaceRoot: wsRoot }

  const baseline = readBaseline(opts.wsId, opts.peerId)
  const selectiveByPath = new Map(opts.selective.map((s) => [s.path, s]))

  // Apply incoming items the operator selected.
  for (const item of opts.diff.inItems) {
    const sel = selectiveByPath.get(item.path)
    if (!sel) {
      result.skipped.push({ path: item.path, reason: 'not selected' })
      continue
    }
    if (!isPathPermittedForApply(item.path)) {
      result.skipped.push({ path: item.path, reason: 'hardcoded-deny' })
      continue
    }
    if (sel.remoteSha256 && item.remoteSha256 && sel.remoteSha256 !== item.remoteSha256) {
      result.skipped.push({ path: item.path, reason: 'stale plan (hash drifted)' })
      continue
    }
    try {
      const target = resolveSafe(ctx, item.path)
      mkdirSync(dirname(target), { recursive: true })
      if (item.op === 'delete') {
        if (existsSync(target)) unlinkSync(target)
        delete baseline.paths[item.path]
        result.applied.delete++
      } else {
        const content = await opts.fetchRemoteContent(item.path)
        writeFileSync(target, content, 'utf8')
        baseline.paths[item.path] = sha256(content)
        if (item.op === 'add') result.applied.add++
        else result.applied.update++
      }
    } catch (err) {
      result.skipped.push({
        path: item.path,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Conflict resolution.
  for (const conflict of opts.diff.conflicts) {
    const sel = selectiveByPath.get(conflict.path)
    if (!sel || !sel.resolve) {
      result.skipped.push({ path: conflict.path, reason: 'unresolved conflict' })
      continue
    }
    if (sel.resolve === 'local') {
      // Keep our content, but update the baseline so next sync sees agreement
      baseline.paths[conflict.path] = conflict.localSha256
      result.conflictsResolved++
      continue
    }
    if (sel.resolve === 'remote') {
      try {
        if (!isPathPermittedForApply(conflict.path)) {
          result.skipped.push({ path: conflict.path, reason: 'hardcoded-deny' })
          continue
        }
        const target = resolveSafe(ctx, conflict.path)
        mkdirSync(dirname(target), { recursive: true })
        const content = await opts.fetchRemoteContent(conflict.path)
        writeFileSync(target, content, 'utf8')
        baseline.paths[conflict.path] = sha256(content)
        result.conflictsResolved++
      } catch (err) {
        result.skipped.push({
          path: conflict.path,
          reason: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  baseline.updatedAt = new Date().toISOString()
  writeBaseline(opts.wsId, baseline)

  await emitFederationEvent(opts.wsId, {
    type: 'federation_apply',
    actorUserId: opts.actorUserId,
    peerId: opts.peerId,
    applied: result.applied,
    conflictsResolved: result.conflictsResolved,
    summary: {
      in: opts.diff.inItems.length,
      out: opts.diff.outItems.length,
      conflicts: opts.diff.conflicts.length,
    },
  })

  return result
}

// Tests-only: expose internals for verification of hardcoded denies.
export const _internal = {
  isPathPermittedForApply,
  HARDCODED_DENY_PREFIXES,
  HARDCODED_DENY_EXACT_DIRS,
}
