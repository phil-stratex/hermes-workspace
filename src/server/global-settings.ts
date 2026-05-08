/**
 * Single reader/writer for `data/global/settings.json`.
 *
 * Layout:
 *   {
 *     schemaVersion: 1,
 *     stackAdmins: Array<{ userId, addedAt, addedBy, addedVia }>,
 *     errors: { retentionDays: number },
 *     branding?: { primaryColor?: string, logoUrl?: string },
 *     federation?: Record<string, unknown> // shape owned by federation modules
 *   }
 *
 * Stack-Admin is the only privilege scoped globally. Workspace-level
 * permissions stay in `permissions.ts` / `workspace-store.ts`. Stack-Admin
 * gates the global error-log because errors leak across workspaces by
 * nature (federation-sync against peer X, login-failure pre-auth, ...).
 *
 * Modifications go through `withMutex('global-settings')` so a parallel
 * `addStackAdmin` + branding-change don't tear the file. Reads are
 * mtime-cached (same pattern as `workspace-store.ts:93-114`) so the hot
 * path (`isStackAdmin()`) is O(1) when the file hasn't changed.
 *
 * Lockout-Schutz (`removeStackAdmin`): refuses to remove the last
 * Stack-Admin so an operator can't accidentally lock themselves out of
 * the error-log. The bootstrap step (`boot-state-check.ts`) ensures
 * there's at least one — by promoting the oldest workspace owner if
 * the list is empty after migration.
 */

import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { writeJsonAtomic, withMutex } from './atomic-write'
import { appendAuditEvent } from './audit-log'
import { getGlobalDir, isValidSlug } from './data-paths'
import { SchemaVersionError, assertSchemaVersion } from './json-schema-version'

export const GLOBAL_SETTINGS_SCHEMA_VERSION = 1
const SETTINGS_MUTEX = 'global-settings'
const DEFAULT_RETENTION_DAYS = 30

export type StackAdminVia = 'cli' | 'ui' | 'bootstrap' | 'migration'

export type StackAdminEntry = {
  userId: string
  addedAt: string
  addedBy: string
  addedVia: StackAdminVia
}

export type ErrorsSection = {
  retentionDays: number
}

export type GlobalSettings = {
  schemaVersion: 1
  stackAdmins: Array<StackAdminEntry>
  errors: ErrorsSection
  branding?: {
    primaryColor?: string
    logoUrl?: string
  }
  federation?: Record<string, unknown>
}

const DEFAULT_SETTINGS: GlobalSettings = {
  schemaVersion: 1,
  stackAdmins: [],
  errors: { retentionDays: DEFAULT_RETENTION_DAYS },
}

function settingsPath(): string {
  return join(getGlobalDir(), 'settings.json')
}

// ─── mtime-cached read ──────────────────────────────────────────────────

let _cached: { mtimeMs: number; value: GlobalSettings } | null = null

function loadFresh(): GlobalSettings {
  const path = settingsPath()
  if (!existsSync(path)) {
    _cached = null
    return DEFAULT_SETTINGS
  }
  const stat = statSync(path)
  if (_cached && _cached.mtimeMs === stat.mtimeMs) return _cached.value
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    _cached = null
    return DEFAULT_SETTINGS
  }
  // assertSchemaVersion throws on mismatch — that's intentional; an
  // operator should see the bad file rather than have us silently fall
  // back to defaults that override their config.
  const validated = assertSchemaVersion<GlobalSettings>(raw, 1, path)
  if (!Array.isArray(validated.stackAdmins)) validated.stackAdmins = []
  if (!validated.errors || typeof validated.errors.retentionDays !== 'number') {
    validated.errors = { retentionDays: DEFAULT_RETENTION_DAYS }
  }
  _cached = { mtimeMs: stat.mtimeMs, value: validated }
  return validated
}

export function getGlobalSettings(): GlobalSettings {
  return loadFresh()
}

export function getStackAdmins(): Array<StackAdminEntry> {
  return getGlobalSettings().stackAdmins.slice()
}

export function isStackAdmin(userId: string | null | undefined): boolean {
  if (!userId || !isValidSlug(userId)) return false
  return getGlobalSettings().stackAdmins.some((a) => a.userId === userId)
}

export function getErrorRetentionDays(): number {
  const n = getGlobalSettings().errors.retentionDays
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return DEFAULT_RETENTION_DAYS
  return Math.floor(n)
}

// ─── writers ─────────────────────────────────────────────────────────────

function writeSettings(next: GlobalSettings): void {
  const path = settingsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeJsonAtomic(path, next)
  _cached = null
}

export async function addStackAdmin(
  userId: string,
  addedBy: string,
  addedVia: StackAdminVia,
): Promise<{ added: boolean; entry: StackAdminEntry }> {
  if (!isValidSlug(userId)) {
    throw new Error(`[global-settings] invalid userId: ${JSON.stringify(userId)}`)
  }
  return withMutex(SETTINGS_MUTEX, async () => {
    const current = loadFresh()
    const existing = current.stackAdmins.find((a) => a.userId === userId)
    if (existing) return { added: false, entry: existing }
    const entry: StackAdminEntry = {
      userId,
      addedAt: new Date().toISOString(),
      addedBy,
      addedVia,
    }
    const next: GlobalSettings = {
      ...current,
      stackAdmins: [...current.stackAdmins, entry],
    }
    writeSettings(next)
    await appendAuditEvent('global', {
      type: 'stack_admin_added',
      target: userId,
      addedBy,
      addedVia,
    })
    return { added: true, entry }
  })
}

export async function removeStackAdmin(
  userId: string,
  removedBy: string,
  removedVia: StackAdminVia,
): Promise<{ removed: boolean }> {
  if (!isValidSlug(userId)) {
    throw new Error(`[global-settings] invalid userId: ${JSON.stringify(userId)}`)
  }
  return withMutex(SETTINGS_MUTEX, async () => {
    const current = loadFresh()
    const exists = current.stackAdmins.some((a) => a.userId === userId)
    if (!exists) return { removed: false }
    if (current.stackAdmins.length <= 1) {
      throw new Error(
        `[global-settings] refuse to remove the last stack-admin (${userId}). Promote a successor first.`,
      )
    }
    const next: GlobalSettings = {
      ...current,
      stackAdmins: current.stackAdmins.filter((a) => a.userId !== userId),
    }
    writeSettings(next)
    await appendAuditEvent('global', {
      type: 'stack_admin_removed',
      target: userId,
      removedBy,
      removedVia,
    })
    return { removed: true }
  })
}

export async function setBrandingColor(color: string, changedBy: string): Promise<GlobalSettings> {
  return withMutex(SETTINGS_MUTEX, async () => {
    const current = loadFresh()
    const next: GlobalSettings = {
      ...current,
      branding: { ...(current.branding ?? {}), primaryColor: color },
    }
    writeSettings(next)
    await appendAuditEvent('global', {
      type: 'global_branding_changed',
      changedBy,
      primaryColor: color,
    })
    return next
  })
}

export async function setErrorRetentionDays(
  days: number,
  changedBy: string,
): Promise<GlobalSettings> {
  if (typeof days !== 'number' || !Number.isFinite(days) || days < 1 || days > 3650) {
    throw new Error(`[global-settings] invalid retentionDays: ${days}`)
  }
  return withMutex(SETTINGS_MUTEX, async () => {
    const current = loadFresh()
    const next: GlobalSettings = {
      ...current,
      errors: { retentionDays: Math.floor(days) },
    }
    writeSettings(next)
    await appendAuditEvent('global', {
      type: 'errors_retention_changed',
      changedBy,
      retentionDays: Math.floor(days),
    })
    return next
  })
}

/** Test-only: drop the in-memory cache so a fixture sees fresh disk state. */
export function _clearGlobalSettingsCacheForTests(): void {
  _cached = null
}

export { SchemaVersionError }
