/**
 * Migration completion marker — SHA256-self-checksummed, with manifest
 * cross-check.
 *
 * The marker (`<dataDir>/global/migration-completed.json`) is written
 * once after a successful single→multi-tenant migration. Subsequent
 * boots read it via `isMigrationCompleted()` to decide whether to run
 * migration again.
 *
 * Two integrity guarantees:
 *
 *  1. **Self-checksum** — the marker carries a `selfChecksum` over the
 *     rest of the body. If anything in the marker is tampered with, the
 *     read fails the check and the marker is treated as missing.
 *
 *  2. **Manifest cross-check** — even if the marker is deleted or
 *     corrupt, an authoritative `migration-manifest.json` next to it
 *     counts as a second proof that migration ran. We refuse to re-run
 *     migration in that case (would reshape an already-migrated layout
 *     and almost certainly destroy data).
 *
 * The combination addresses L4: manual deletion of the marker doesn't
 * silently re-trigger migration, and accidental corruption of the marker
 * doesn't either.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

import { getGlobalDir } from './data-paths'
import { writeJsonAtomic } from './atomic-write'

const MARKER_FILE = 'migration-completed.json'
const MANIFEST_FILE = 'migration-manifest.json'
const CURRENT_MIGRATION_VERSION = 1

export function getMarkerPath(): string {
  return join(getGlobalDir(), MARKER_FILE)
}

export function getManifestPath(): string {
  return join(getGlobalDir(), MANIFEST_FILE)
}

export type MarkerContent = {
  schemaVersion: 1
  completedAt: string
  manifestPath: string
  migrationVersion: number
  selfChecksum: string
}

type MarkerBody = Omit<MarkerContent, 'selfChecksum'>

function computeSelfChecksum(body: MarkerBody): string {
  // Stable JSON serialisation: sort keys alphabetically. Without sorted
  // keys the checksum would depend on insertion order, which would make
  // a re-serialisation by a different writer (or a different Node minor
  // release) flag as tampered.
  const sortedKeys = Object.keys(body).sort()
  const stable = JSON.stringify(body, sortedKeys)
  return createHash('sha256').update(stable).digest('hex')
}

export type WriteMarkerOpts = Partial<{
  completedAt: string
  manifestPath: string
  migrationVersion: number
}>

export function writeMarker(opts: WriteMarkerOpts = {}): MarkerContent {
  const body: MarkerBody = {
    schemaVersion: 1,
    completedAt: opts.completedAt ?? new Date().toISOString(),
    manifestPath: opts.manifestPath ?? getManifestPath(),
    migrationVersion: opts.migrationVersion ?? CURRENT_MIGRATION_VERSION,
  }
  const content: MarkerContent = {
    ...body,
    selfChecksum: computeSelfChecksum(body),
  }
  mkdirSync(dirname(getMarkerPath()), { recursive: true })
  writeJsonAtomic(getMarkerPath(), content)
  return content
}

function readMarkerRaw(): unknown | null {
  if (!existsSync(getMarkerPath())) return null
  try {
    return JSON.parse(readFileSync(getMarkerPath(), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Returns `true` only if the marker exists, parses, has all required
 * fields with expected types, AND its self-checksum matches.
 */
export function isMarkerSelfChecksumValid(): boolean {
  const raw = readMarkerRaw()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const obj = raw as Record<string, unknown>
  if (obj.schemaVersion !== 1) return false
  if (typeof obj.selfChecksum !== 'string' || obj.selfChecksum.length === 0) return false
  if (typeof obj.completedAt !== 'string') return false
  if (typeof obj.manifestPath !== 'string') return false
  if (typeof obj.migrationVersion !== 'number') return false
  const expected = computeSelfChecksum({
    schemaVersion: 1,
    completedAt: obj.completedAt,
    manifestPath: obj.manifestPath,
    migrationVersion: obj.migrationVersion,
  })
  return expected === obj.selfChecksum
}

/**
 * Truth-table for the migration-completed state:
 *
 *   marker valid           → true
 *   marker missing/corrupt + manifest exists → true (L4 cross-check)
 *   marker missing/corrupt + manifest missing → false
 *
 * The middle row prevents re-triggering migration if someone has
 * deleted the marker (intentionally or accidentally) on a stack where
 * migration has already shaped the layout.
 */
export function isMigrationCompleted(): boolean {
  if (isMarkerSelfChecksumValid()) return true
  if (existsSync(getManifestPath())) {
    console.warn(
      `[migration-marker] marker missing or corrupt but manifest exists at ${getManifestPath()} — treating as completed`,
    )
    return true
  }
  return false
}
