/**
 * Per-user UI preferences. Stored at
 * `data/users/<userId>/preferences.json` so they ride along with the
 * user profile and survive workspace switches.
 *
 * Currently only carries `lastErrorSeenAt` (NotificationBell unread
 * counter), but the schema is intentionally extensible — the field map
 * is loose so future preference additions don't need a schema bump.
 *
 * Writes go through `withMutex(\`user-preferences:${userId}\`)` so a
 * 50-parallel update from a runaway client doesn't lose updates.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { writeJsonAtomic, withMutex } from './atomic-write'
import { getUserDir, isValidSlug } from './data-paths'
import { assertSchemaVersion } from './json-schema-version'

export const USER_PREFERENCES_SCHEMA_VERSION = 1

export type UserPreferences = {
  schemaVersion: 1
  /** ISO timestamp of the most recent visit to the error-log. Used by
   *  the NotificationBell to compute the unread-count over the last 24h. */
  lastErrorSeenAt?: string
  /** Free-form bag for future preferences — keep small. */
  ui?: Record<string, unknown>
}

const DEFAULT_PREFS: UserPreferences = { schemaVersion: 1 }

function preferencesPath(userId: string): string {
  return join(getUserDir(userId), 'preferences.json')
}

function mutex(userId: string): string {
  return `user-preferences:${userId}`
}

function ensureValidId(userId: string): void {
  if (!isValidSlug(userId)) {
    throw new Error(`[user-preferences] invalid userId: ${JSON.stringify(userId)}`)
  }
}

export function getUserPreferences(userId: string): UserPreferences {
  ensureValidId(userId)
  const path = preferencesPath(userId)
  if (!existsSync(path)) return DEFAULT_PREFS
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return assertSchemaVersion<UserPreferences>(raw, 1, path)
  } catch {
    return DEFAULT_PREFS
  }
}

export async function updateUserPreferences(
  userId: string,
  patch: Partial<Omit<UserPreferences, 'schemaVersion'>>,
): Promise<UserPreferences> {
  ensureValidId(userId)
  return withMutex(mutex(userId), async () => {
    const current = getUserPreferences(userId)
    const next: UserPreferences = {
      ...current,
      ...patch,
      schemaVersion: USER_PREFERENCES_SCHEMA_VERSION,
    }
    const path = preferencesPath(userId)
    mkdirSync(dirname(path), { recursive: true })
    writeJsonAtomic(path, next)
    return next
  })
}
