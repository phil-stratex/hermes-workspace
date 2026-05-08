/**
 * Workspace swarm.yaml validator (Plan-Finding L3).
 *
 * Per the D2 lookup either/or rule, a workspace either has its own
 * `data/workspaces/<wsId>/swarm.yaml` (Custom roster) or falls back
 * to the repo-root `swarm.yaml` (Default roster). Custom rosters
 * reference Worker-IDs the code implements — when an upstream pull
 * removes one, every Custom workspace that pinned it is broken.
 *
 * This validator runs at three trigger points:
 *   1. Save-time — Workspace owner saves their roster via the API
 *      and gets immediate feedback for unknown Worker-IDs.
 *   2. Boot-time — `server-entry.js` calls `revalidateAllWorkspaceRosters`
 *      after the migration / symlink-reconcile steps so a stale
 *      issues-file from the previous boot is overwritten.
 *   3. package.json-Hash-Trigger — when the Vite dev-server
 *      restarts because `package.json` changed (deploy.sh signal),
 *      we re-run validation in case the upstream package change
 *      brought new Worker types or removed one.
 *
 * Output: `data/global/swarm-yaml-issues.json` — read by the
 * `RosterIssuesBanner` UI component to show owners which of their
 * Custom rosters have stale references.
 */

import {
  createHash,
  randomBytes as _randomBytes,
} from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { parse as parseYaml } from 'yaml'

import { writeJsonAtomic, withMutex } from './atomic-write'
import { getDataDir, getGlobalDir, getWorkspaceDir, isValidSlug } from './data-paths'
import { listWorkspaces } from './workspace-store'

void _randomBytes

export const ISSUES_SCHEMA_VERSION = 1

export type RosterIssue = {
  wsId: string
  file: string
  errors: Array<string>
}

export type RosterIssuesReport = {
  schemaVersion: 1
  scannedAt: string
  packageJsonHash: string
  issues: Array<RosterIssue>
}

export function workspaceSwarmYamlPath(wsId: string): string {
  return join(getWorkspaceDir(wsId), 'swarm.yaml')
}

export function repoDefaultSwarmYamlPath(): string {
  // The repo root is the parent dir of the workspace's source tree
  // when running in dev. In a deployed container the path is set
  // via HERMES_REPO_ROOT.
  const explicit = process.env.HERMES_REPO_ROOT
  if (explicit && existsSync(join(explicit, 'swarm.yaml'))) {
    return join(explicit, 'swarm.yaml')
  }
  return 'swarm.yaml'
}

export function issuesFilePath(): string {
  return join(getGlobalDir(), 'swarm-yaml-issues.json')
}

function packageJsonPath(): string {
  const explicit = process.env.HERMES_REPO_ROOT
  if (explicit && existsSync(join(explicit, 'package.json'))) {
    return join(explicit, 'package.json')
  }
  return 'package.json'
}

export function packageJsonHash(): string {
  const path = packageJsonPath()
  if (!existsSync(path)) return 'no-package-json'
  try {
    const content = readFileSync(path, 'utf8')
    return createHash('sha256').update(content).digest('hex')
  } catch {
    return 'unreadable'
  }
}

// ─── Worker-ID source-of-truth ─────────────────────────────────────────

/**
 * Default Worker-IDs derived from the repo-root swarm.yaml. Real
 * deployments can pass a richer set in via env (semicolon-separated)
 * for testing or when the implementation diverges from the file.
 */
export function getCurrentWorkerImpls(): Set<string> {
  const explicit = (process.env.HERMES_KNOWN_WORKER_IDS || '').trim()
  if (explicit.length > 0) {
    return new Set(
      explicit
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    )
  }
  const path = repoDefaultSwarmYamlPath()
  if (!existsSync(path)) return new Set()
  try {
    const yaml = parseYaml(readFileSync(path, 'utf8')) as { workers?: Array<{ id?: string }> }
    const ids = new Set<string>()
    for (const w of yaml?.workers ?? []) {
      if (typeof w.id === 'string' && w.id.length > 0) ids.add(w.id)
    }
    return ids
  } catch {
    return new Set()
  }
}

// ─── Validation ────────────────────────────────────────────────────────

export type RosterValidationResult = {
  ok: boolean
  errors: Array<string>
}

export function validateRosterContent(
  yamlText: string,
  knownWorkerIds: Set<string>,
): RosterValidationResult {
  const errors: Array<string> = []
  let parsed: unknown
  try {
    parsed = parseYaml(yamlText)
  } catch (err) {
    errors.push(`yaml parse error: ${err instanceof Error ? err.message : String(err)}`)
    return { ok: false, errors }
  }
  if (!parsed || typeof parsed !== 'object') {
    errors.push('top-level must be an object')
    return { ok: false, errors }
  }
  const obj = parsed as { workers?: unknown }
  if (!Array.isArray(obj.workers)) {
    errors.push('workers[] missing')
    return { ok: false, errors }
  }
  const seenIds = new Set<string>()
  for (let i = 0; i < obj.workers.length; i++) {
    const w = obj.workers[i] as { id?: unknown }
    if (typeof w.id !== 'string' || w.id.length === 0) {
      errors.push(`workers[${i}].id missing or non-string`)
      continue
    }
    if (seenIds.has(w.id)) {
      errors.push(`workers[${i}].id duplicated: ${w.id}`)
    }
    seenIds.add(w.id)
    if (!knownWorkerIds.has(w.id)) {
      errors.push(`unknown worker-id: ${w.id} (not in code implementation)`)
    }
  }
  return { ok: errors.length === 0, errors }
}

export function validateWorkspaceRoster(wsId: string): RosterValidationResult {
  if (!isValidSlug(wsId)) {
    return { ok: false, errors: [`invalid wsId: ${wsId}`] }
  }
  const path = workspaceSwarmYamlPath(wsId)
  if (!existsSync(path)) {
    // No custom roster → workspace uses the repo default. That's fine.
    return { ok: true, errors: [] }
  }
  return validateRosterContent(readFileSync(path, 'utf8'), getCurrentWorkerImpls())
}

// ─── Boot-time / hash-triggered re-validation ──────────────────────────

const ISSUES_MUTEX = 'swarm-yaml-issues'

export async function revalidateAllWorkspaceRosters(): Promise<RosterIssuesReport> {
  return withMutex(ISSUES_MUTEX, async () => {
    const issues: Array<RosterIssue> = []
    for (const wsId of listWorkspaces({ includeDeleted: false })) {
      const path = workspaceSwarmYamlPath(wsId)
      if (!existsSync(path)) continue
      const result = validateWorkspaceRoster(wsId)
      if (!result.ok) issues.push({ wsId, file: path, errors: result.errors })
    }
    const report: RosterIssuesReport = {
      schemaVersion: 1,
      scannedAt: new Date().toISOString(),
      packageJsonHash: packageJsonHash(),
      issues,
    }
    mkdirSync(dirname(issuesFilePath()), { recursive: true })
    writeJsonAtomic(issuesFilePath(), report)
    return report
  })
}

export function readIssuesReport(): RosterIssuesReport | null {
  const path = issuesFilePath()
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RosterIssuesReport
  } catch {
    return null
  }
}

/**
 * Re-validate when the package.json hash has changed since the last
 * scan. Cheap to call from the boot sequence so a `pnpm install`-style
 * change automatically retriggers without a full server restart cycle.
 */
export async function revalidateIfPackageChanged(): Promise<RosterIssuesReport | null> {
  const previous = readIssuesReport()
  const currentHash = packageJsonHash()
  if (previous && previous.packageJsonHash === currentHash) return null
  return revalidateAllWorkspaceRosters()
}

void getDataDir
void statSync
