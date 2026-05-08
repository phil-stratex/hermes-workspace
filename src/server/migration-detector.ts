/**
 * Detect the legacy Hermes stack layout for migration.
 *
 * The legacy single-tenant stack stored data under one root:
 *   - `HERMES_HOME` (env) or `~/.hermes` by default
 *
 * Subdirectories of interest:
 *   - `memories/` (Markdown notes)              ← workspace memories
 *   - `memory/`  (older variant, also supported)
 *   - `skills/` (SKILL.md trees)                ← workspace skills
 *   - `council/sessions/` (council history)     ← workspace council
 *   - `profiles/` (worker profile dirs)         ← worker-profiles/
 *   - `session-titles.json`                     ← merged into sessions-meta
 *   - `workspace-sessions.json` (legacy tokens) ← cleared post-migrate
 *
 * Plus the external Swarm-Memory root:
 *   - `~/.openclaw/workspace/memory/swarm/`
 *     (handled by `migration-symlink-reconcile.ts` at boot — NOT
 *      copied during migration, just listed in the manifest for
 *      forensic completeness.)
 *
 * The migration step only READS from this layout. Writes happen
 * exclusively under the staging root (`HERMES_DATA_DIR`).
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type SourceLayout = {
  /** Root for the legacy state — `HERMES_LEGACY_DATA_DIR` or `HERMES_HOME` or `~/.hermes`. */
  hermesHome: string
  /** Absolute path of the external Swarm-Memory root, or null if absent. */
  openclawSwarmDir: string | null
  /** Whether `HERMES_PASSWORD` (or `CLAUDE_PASSWORD`) is set in the env. */
  hasLegacyPassword: boolean
  /** Subdirs the migration will copy. */
  legacyDirs: {
    memories: string | null
    skills: string | null
    council: string | null
    profiles: string | null
  }
  /** Sidecar files that are merged or cleared. */
  legacyFiles: {
    sessionTitles: string | null
    workspaceSessions: string | null
  }
}

export function detectLegacySource(): SourceLayout {
  const hermesHome =
    process.env.HERMES_LEGACY_DATA_DIR
    ?? process.env.HERMES_HOME
    ?? process.env.CLAUDE_HOME
    ?? join(homedir(), '.hermes')

  return {
    hermesHome,
    openclawSwarmDir: detectOpenclawSwarmDir(),
    hasLegacyPassword: hasNonEmptyEnv('HERMES_PASSWORD') || hasNonEmptyEnv('CLAUDE_PASSWORD'),
    legacyDirs: {
      memories: pickFirstExisting([
        join(hermesHome, 'memories'),
        join(hermesHome, 'memory'),
      ]),
      skills: existingDir(join(hermesHome, 'skills')),
      council: existingDir(join(hermesHome, 'council')),
      profiles: existingDir(join(hermesHome, 'profiles')),
    },
    legacyFiles: {
      sessionTitles: existingFile(join(hermesHome, 'session-titles.json')),
      workspaceSessions: existingFile(join(hermesHome, 'workspace-sessions.json')),
    },
  }
}

export function detectOpenclawSwarmDir(): string | null {
  const explicit = process.env.HERMES_LEGACY_SWARM_MEMORY_ROOT
  const candidates = [
    explicit,
    join(homedir(), '.openclaw', 'workspace', 'memory', 'swarm'),
  ].filter((p): p is string => typeof p === 'string')

  for (const p of candidates) {
    const d = existingDir(p)
    if (d) return d
  }
  return null
}

export function readLegacyPassword(): string | null {
  const fromHermes = process.env.HERMES_PASSWORD
  if (fromHermes && fromHermes.length > 0) return fromHermes
  const fromClaude = process.env.CLAUDE_PASSWORD
  if (fromClaude && fromClaude.length > 0) return fromClaude
  return null
}

export type LegacySessionTitle = { sessionId: string; title: string }

/**
 * Returns the legacy `session-titles.json` content as a list. Used by
 * the migration step to merge titles into `sessions-meta.json` (no
 * separate file in the new layout).
 */
export function readLegacySessionTitles(source: SourceLayout): Array<LegacySessionTitle> {
  if (!source.legacyFiles.sessionTitles) return []
  try {
    const raw = JSON.parse(readFileSync(source.legacyFiles.sessionTitles, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const out: Array<LegacySessionTitle> = []
    for (const [sessionId, title] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof title === 'string' && title.length > 0) out.push({ sessionId, title })
    }
    return out
  } catch {
    return []
  }
}

// ─── helpers ───────────────────────────────────────────────────────────

function existingDir(path: string): string | null {
  try {
    if (!existsSync(path)) return null
    return statSync(path).isDirectory() ? path : null
  } catch {
    return null
  }
}

function existingFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null
    return statSync(path).isFile() ? path : null
  } catch {
    return null
  }
}

function pickFirstExisting(paths: ReadonlyArray<string>): string | null {
  for (const p of paths) {
    const d = existingDir(p)
    if (d) return d
  }
  return null
}

function hasNonEmptyEnv(name: string): boolean {
  const v = process.env[name]
  return typeof v === 'string' && v.length > 0
}
