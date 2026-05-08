/**
 * Central data-boundary for the multi-workspace refactor.
 *
 * Every reader / writer that touches workspace, user, or global state
 * resolves its filesystem path through one of these helpers — never via
 * `process.env.HERMES_HOME` directly. That keeps the layout in
 * `data/workspaces/<id>/`, `data/users/<id>/`, `data/global/` enforced
 * in one place and makes future re-rooting (e.g. for Electron desktop
 * builds) a single edit.
 *
 * Resolution order for the data root:
 *   1. `HERMES_DATA_DIR` (explicit override)
 *   2. `HERMES_HOME` (existing convention, container/VPS)
 *   3. `<homedir>/.hermes` (dev fallback)
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

const DATA_DIR_ENV = 'HERMES_DATA_DIR'

export function getDataDir(): string {
  const fromEnv = process.env[DATA_DIR_ENV]
  if (fromEnv && fromEnv.length > 0) return fromEnv
  const fromHermesHome = process.env.HERMES_HOME
  if (fromHermesHome && fromHermesHome.length > 0) return fromHermesHome
  return join(homedir(), '.hermes')
}

export function getWorkspaceDir(workspaceId: string): string {
  assertSlug('workspaceId', workspaceId)
  return join(getDataDir(), 'workspaces', workspaceId)
}

export function getUserDir(userId: string): string {
  assertSlug('userId', userId)
  return join(getDataDir(), 'users', userId)
}

export function getGlobalDir(): string {
  return join(getDataDir(), 'global')
}

export function getTrashDir(): string {
  return join(getGlobalDir(), 'trash')
}

/**
 * URL-safe slug: lowercase letters, digits, dashes; must start and end with
 * an alphanumeric. Disallows path-traversal (`..`, `/`, `\`) and shell
 * metacharacters by construction. Length capped at 64 chars.
 */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export function isValidSlug(value: string): boolean {
  return typeof value === 'string' && SLUG_RE.test(value)
}

function assertSlug(label: string, value: string): void {
  if (!isValidSlug(value)) {
    throw new Error(
      `[data-paths] invalid ${label}: ${JSON.stringify(value)} — must be url-safe slug (a-z, 0-9, -, max 64 chars)`,
    )
  }
}
