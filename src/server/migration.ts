/**
 * Single-tenant → multi-tenant migration (Plan-Findings R3, N3, N5, L1, L2).
 *
 * Two run modes:
 *
 *   - **Sidecar (default, R3 zero-risk)** — invoked from a separate
 *     container with `-v <legacy>:/in:ro -v <staging>:/out`. The
 *     migration reads from `/in` (HERMES_LEGACY_DATA_DIR), writes
 *     under `/out` (HERMES_DATA_DIR). The live `/opt/data` is
 *     unaffected; the operator does the atomic rename
 *     (`mv /opt/data /opt/data.pre-migration && mv /opt/data-staging /opt/data`)
 *     after the migration exits 0.
 *
 *   - **In-place (Edge-case, opt-in)** — `HERMES_MIGRATE_IN_PLACE=1`.
 *     Reads + writes the same root. Use only when a sidecar isn't
 *     available — the rollback story is much weaker (manifest-driven
 *     reverse moves, race-vulnerable mid-flight).
 *
 * Either way, the migration consists of two phases: `planMigration`
 * computes a `MigrationPlan` (pure function, no side-effects), and
 * `executeMigration(plan)` runs it. The CLI wrapper supports
 * `--dry-run` by stopping after the plan.
 *
 * Pre-flight (L1+N6): refuses to run unless `data/global/.backup-confirmed`
 * is a JSON file with `snapshotId` non-empty AND `confirmedAt` < 24h.
 *
 * Multi-person guard (L2): if the heuristic in
 * `migration-multi-person.ts` flags multi-person, refuses unless
 * `data/global/.multi-person-tag-confirmed` is present and names the
 * migrant user-id.
 *
 * After a successful run:
 *   - `data/global/migration-manifest.json` (MigrationManifest, N5)
 *   - `data/global/migration-completed.json` (SHA256-self, L4)
 *   - workspace-sessions.json under the legacy root is cleared so
 *     pre-migration tokens stop working immediately.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import { writeJsonAtomic } from './atomic-write'
import { hashPassword } from './auth-passwords'
import { getDataDir, getGlobalDir, getUserDir, getWorkspaceDir, isValidSlug } from './data-paths'
import { detectLegacySource, readLegacyPassword, readLegacySessionTitles } from './migration-detector'
import type { SourceLayout } from './migration-detector'
import type { MultiPersonAnalysis } from './migration-multi-person'
import {
  analyzeMultiPerson,
  consumeMultiPersonConfirmation,
  isMultiPersonConfirmed,
} from './migration-multi-person'
import type { LegacyGatewaySession } from './migration-multi-person'
import { writeMarker } from './migration-marker'

export const MIGRATION_VERSION = 1

export type MigrationParams = {
  ownerUserId: string
  ownerEmail: string
  ownerName: string
  workspaceId: string
  workspaceName: string
  workspaceDescription?: string
  primaryColor?: string
  /** Optional override of the temp owner password — defaults to the legacy HERMES_PASSWORD. */
  ownerPasswordOverride?: string
}

export type MigrationMove = {
  from: string
  to: string
  type: 'copy' | 'move' | 'symlink'
  /** Human-readable reason — surfaced in the manifest for forensics. */
  note?: string
}

export type MigrationManifest = {
  schemaVersion: 1
  startedAt: string
  completedAt?: string
  migrationVersion: 1
  source: {
    hermesHome: string
    openclawSwarmDir: string | null
    gatewayBaseUrl?: string
  }
  params: MigrationParams
  moves: Array<MigrationMove>
  taggedSessions: Array<{ id: string; ownerId: string }>
  rollbackInstructions: {
    mode: 'sidecar' | 'in-place'
    sidecarRollback?: { failedTarget: string; preMigrationSource: string }
    inPlaceRollback?: { reverseMoves: Array<{ from: string; to: string }> }
  }
  multiPerson?: MultiPersonAnalysis
}

export type MigrationPlan = {
  source: SourceLayout
  params: MigrationParams
  targetDataDir: string
  mode: 'sidecar' | 'in-place'
  moves: Array<MigrationMove>
  ownerProfile: {
    schemaVersion: 1
    id: string
    email: string
    name: string
    createdAt: string
    defaultWorkspaceId: string
    status: 'active'
    failedLoginCount: 0
    mustChangePassword: false
  }
  workspaceMeta: {
    schemaVersion: 1
    id: string
    name: string
    description?: string
    createdAt: string
    createdBy: string
    branding: { primaryColor: string }
    settings: { features: Record<string, boolean> }
  }
  members: Array<{ userId: string; role: 'owner'; joinedAt: string; addedBy: string }>
}

export type ExecuteOpts = {
  /** Caller-supplied legacy gateway session list (kept abstract so tests
   *  don't need a fake gateway). */
  legacySessions?: ReadonlyArray<LegacyGatewaySession>
  /** Disable the multi-person heuristic check entirely (for unit tests
   *  that don't care about it). */
  skipMultiPersonGuard?: boolean
  /** Disable the backup-confirmed pre-flight (for unit tests). */
  skipBackupCheck?: boolean
}

export type ExecuteResult = {
  manifestPath: string
  manifest: MigrationManifest
}

// ─── Pre-Flight ────────────────────────────────────────────────────────

const BACKUP_MARKER_FILE = '.backup-confirmed'
const BACKUP_TTL_MS = 24 * 60 * 60 * 1000

export type BackupConfirmation = {
  confirmedAt: string
  snapshotId: string
  confirmedBy: string
}

export function readBackupConfirmation(): BackupConfirmation | null {
  const path = join(getGlobalDir(), BACKUP_MARKER_FILE)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (
      typeof raw?.confirmedAt !== 'string'
      || typeof raw?.snapshotId !== 'string'
      || typeof raw?.confirmedBy !== 'string'
      || raw.snapshotId.length === 0
    ) return null
    return raw as BackupConfirmation
  } catch {
    return null
  }
}

export function isBackupConfirmedFresh(): boolean {
  const c = readBackupConfirmation()
  if (!c) return false
  const age = Date.now() - new Date(c.confirmedAt).getTime()
  if (Number.isNaN(age) || age < 0) return false
  return age <= BACKUP_TTL_MS
}

// ─── Plan ──────────────────────────────────────────────────────────────

function determineMode(): 'sidecar' | 'in-place' {
  // Explicit opt-in to the unsafe in-place mode wins over implicit
  // sidecar detection. Operators or tests that set both env vars
  // expect HERMES_MIGRATE_IN_PLACE to take precedence.
  if (process.env.HERMES_MIGRATE_IN_PLACE === '1') return 'in-place'
  if (process.env.HERMES_LEGACY_DATA_DIR && process.env.HERMES_LEGACY_DATA_DIR.length > 0) {
    return 'sidecar'
  }
  return 'in-place'
}

export function planMigration(params: MigrationParams): MigrationPlan {
  if (!isValidSlug(params.ownerUserId)) {
    throw new Error(`[migration] invalid ownerUserId: ${params.ownerUserId}`)
  }
  if (!isValidSlug(params.workspaceId)) {
    throw new Error(`[migration] invalid workspaceId: ${params.workspaceId}`)
  }
  const source = detectLegacySource()
  const mode = determineMode()
  const targetDataDir = getDataDir()
  const wsRoot = join(targetDataDir, 'workspaces', params.workspaceId)

  const moves: Array<MigrationMove> = []
  if (source.legacyDirs.memories) {
    moves.push({
      from: source.legacyDirs.memories,
      to: join(wsRoot, 'memories'),
      type: 'copy',
      note: 'workspace memories (markdown)',
    })
  }
  if (source.legacyDirs.skills) {
    moves.push({
      from: source.legacyDirs.skills,
      to: join(wsRoot, 'skills'),
      type: 'copy',
      note: 'workspace skills',
    })
  }
  if (source.legacyDirs.council) {
    moves.push({
      from: source.legacyDirs.council,
      to: join(wsRoot, 'council'),
      type: 'copy',
      note: 'council history',
    })
  }
  if (source.legacyDirs.profiles) {
    moves.push({
      from: source.legacyDirs.profiles,
      to: join(wsRoot, 'worker-profiles'),
      type: 'copy',
      note: 'worker profiles',
    })
  }
  if (source.openclawSwarmDir) {
    // Logged for forensics; the actual symlink is created at boot time
    // by `migration-symlink-reconcile.ts` (Plan-Finding N1).
    moves.push({
      from: source.openclawSwarmDir,
      to: join(wsRoot, 'memories', 'swarm'),
      type: 'symlink',
      note: 'legacy swarm-shared-memory (boot reconcile, N1)',
    })
  }

  const now = new Date().toISOString()

  return {
    source,
    params,
    targetDataDir,
    mode,
    moves,
    ownerProfile: {
      schemaVersion: 1,
      id: params.ownerUserId,
      email: params.ownerEmail,
      name: params.ownerName,
      createdAt: now,
      defaultWorkspaceId: params.workspaceId,
      status: 'active',
      failedLoginCount: 0,
      mustChangePassword: false,
    },
    workspaceMeta: {
      schemaVersion: 1,
      id: params.workspaceId,
      name: params.workspaceName,
      description: params.workspaceDescription,
      createdAt: now,
      createdBy: params.ownerUserId,
      branding: { primaryColor: params.primaryColor ?? '#5B6CFF' },
      settings: { features: {} },
    },
    members: [
      {
        userId: params.ownerUserId,
        role: 'owner',
        joinedAt: now,
        addedBy: params.ownerUserId,
      },
    ],
  }
}

// ─── Execute ───────────────────────────────────────────────────────────

export async function executeMigration(
  plan: MigrationPlan,
  opts: ExecuteOpts = {},
): Promise<ExecuteResult> {
  // 1. Pre-flight guards.
  if (!opts.skipBackupCheck && !isBackupConfirmedFresh()) {
    throw new Error(
      '[migration] pre-flight failed: data/global/.backup-confirmed missing, malformed, or older than 24h. '
      + 'Run scripts/admin/confirm-backup-done.ts <snapshotId> first.',
    )
  }

  const legacySessions = opts.legacySessions ?? []
  const multiPerson = analyzeMultiPerson(legacySessions)
  if (
    !opts.skipMultiPersonGuard
    && multiPerson.flagged
    && !isMultiPersonConfirmed(plan.params.ownerUserId)
  ) {
    throw new Error(
      `[migration] multi-person heuristic flagged: ${multiPerson.reasons.join('; ')}. `
      + 'Run scripts/admin/confirm-multi-person-tag.ts <migrant-user-id> to acknowledge.',
    )
  }

  const startedAt = new Date().toISOString()
  const taggedSessions: Array<{ id: string; ownerId: string }> = []

  // 2. Copy each move (skip symlinks — boot does those).
  for (const move of plan.moves) {
    if (move.type === 'symlink') continue
    if (!existsSync(move.from)) continue
    mkdirSync(dirname(move.to), { recursive: true })
    cpSync(move.from, move.to, { recursive: true, force: false, errorOnExist: false })
  }

  // 3. Owner profile + password.
  const userDir = getUserDir(plan.ownerProfile.id)
  mkdirSync(userDir, { recursive: true })
  writeJsonAtomic(join(userDir, 'profile.json'), plan.ownerProfile)
  const password =
    plan.params.ownerPasswordOverride
    ?? readLegacyPassword()
    ?? generateFallbackPassword()
  const hash = await hashPassword(password)
  mkdirSync(join(userDir, 'auth'), { recursive: true })
  writeFileSync(join(userDir, 'auth', 'password-hash.txt'), hash, {
    encoding: 'utf8',
    mode: 0o600,
  })

  // 4. Workspace meta + members.
  const wsDir = getWorkspaceDir(plan.params.workspaceId)
  mkdirSync(wsDir, { recursive: true })
  writeJsonAtomic(join(wsDir, 'meta.json'), plan.workspaceMeta)
  writeJsonAtomic(join(wsDir, 'members.json'), {
    schemaVersion: 1,
    members: plan.members,
  })

  // 5. Tag every legacy gateway session into sessions-meta.json,
  //    merging any title from session-titles.json so the new layout
  //    isn't missing user-set names.
  const titles = readLegacySessionTitles(plan.source)
  const titleMap = new Map(titles.map((t) => [t.sessionId, t.title]))
  const sessionsMeta: Record<string, unknown> = {}
  for (const s of legacySessions) {
    sessionsMeta[s.id] = {
      ownerId: plan.ownerProfile.id,
      shared: false,
      createdAt: s.startedAtSec
        ? new Date(s.startedAtSec * 1000).toISOString()
        : startedAt,
      lastActivityAt: s.lastActiveSec
        ? new Date(s.lastActiveSec * 1000).toISOString()
        : startedAt,
      ...(titleMap.has(s.id) ? { title: titleMap.get(s.id) } : {}),
    }
    taggedSessions.push({ id: s.id, ownerId: plan.ownerProfile.id })
  }
  writeJsonAtomic(join(wsDir, 'sessions-meta.json'), {
    schemaVersion: 1,
    sessions: sessionsMeta,
  })

  // 6. Manifest (N5) + Marker (D3 / L4).
  const manifest: MigrationManifest = {
    schemaVersion: 1,
    startedAt,
    completedAt: new Date().toISOString(),
    migrationVersion: MIGRATION_VERSION,
    source: {
      hermesHome: plan.source.hermesHome,
      openclawSwarmDir: plan.source.openclawSwarmDir,
      gatewayBaseUrl: process.env.HERMES_API_URL,
    },
    params: plan.params,
    moves: plan.moves,
    taggedSessions,
    rollbackInstructions: rollbackInstructionsFor(plan),
    multiPerson,
  }
  const manifestPath = join(getGlobalDir(), 'migration-manifest.json')
  mkdirSync(dirname(manifestPath), { recursive: true })
  writeJsonAtomic(manifestPath, manifest)

  writeMarker({
    completedAt: manifest.completedAt,
    manifestPath,
    migrationVersion: MIGRATION_VERSION,
  })

  // 7. Clear legacy workspace-sessions.json so pre-migration tokens
  //    stop working the moment the new code path takes over.
  if (plan.source.legacyFiles.workspaceSessions) {
    try {
      writeFileSync(
        plan.source.legacyFiles.workspaceSessions,
        JSON.stringify({ tokens: {} }),
        { encoding: 'utf8', mode: 0o600 },
      )
    } catch {
      // Best-effort — auth-middleware migration-marker check disables
      // legacy mode anyway.
    }
  }

  // 8. Consume the multi-person confirmation marker (one-shot).
  if (multiPerson.flagged) {
    consumeMultiPersonConfirmation()
  }

  return { manifestPath, manifest }
}

function rollbackInstructionsFor(plan: MigrationPlan): MigrationManifest['rollbackInstructions'] {
  if (plan.mode === 'sidecar') {
    return {
      mode: 'sidecar',
      sidecarRollback: {
        failedTarget: plan.targetDataDir,
        preMigrationSource: plan.source.hermesHome,
      },
    }
  }
  // In-place: list reverse moves so the rollback CLI can apply them.
  return {
    mode: 'in-place',
    inPlaceRollback: {
      reverseMoves: plan.moves
        .filter((m) => m.type !== 'symlink')
        .map((m) => ({ from: m.to, to: m.from })),
    },
  }
}

function generateFallbackPassword(): string {
  // Used only when neither HERMES_PASSWORD nor an override is set.
  // Gives the operator something to log in with after migration; they
  // can rotate it via the change-password flow.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const buf = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(buf)
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  return Buffer.from(buf).toString('base64url').slice(0, 24)
}

// ─── Rollback (used by scripts/admin/migration-rollback.ts) ────────────

export type RollbackResult = {
  mode: 'sidecar' | 'in-place'
  reversed: Array<{ from: string; to: string }>
  cleared: Array<string>
}

/**
 * In-place rollback: reverse the moves recorded in the manifest, then
 * delete the marker + manifest themselves so a future migration can
 * re-run from scratch.
 *
 * For sidecar rollback, the reverse step is a single `mv` performed
 * by the operator outside this script; the function then just
 * deletes the marker/manifest from the failed staging dir.
 */
export function rollbackFromManifest(): RollbackResult {
  const manifestPath = join(getGlobalDir(), 'migration-manifest.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`[migration-rollback] manifest not found at ${manifestPath}`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as MigrationManifest
  const reversed: Array<{ from: string; to: string }> = []
  const cleared: Array<string> = []

  if (manifest.rollbackInstructions.mode === 'in-place') {
    for (const m of manifest.rollbackInstructions.inPlaceRollback?.reverseMoves ?? []) {
      // Best-effort: copy back, don't fail if source was already
      // restored manually. Real `mv` lives in the CLI wrapper.
      reversed.push(m)
    }
  }
  // Either way, delete the marker + manifest so the stack returns to
  // a "needs migration" state. The CLI wrapper does the actual file
  // moves before calling this.
  try {
    unlinkSync(manifestPath)
    cleared.push(manifestPath)
  } catch {
    // already gone
  }
  const markerPath = join(getGlobalDir(), 'migration-completed.json')
  try {
    if (existsSync(markerPath)) {
      unlinkSync(markerPath)
      cleared.push(markerPath)
    }
  } catch {
    // ignore
  }
  return { mode: manifest.rollbackInstructions.mode, reversed, cleared }
}
