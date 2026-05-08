/**
 * User-store: profile.json + failed-login counter, atomic-write +
 * per-user mutex serialisation.
 *
 * Layout:
 *   data/users/<userId>/profile.json        (UserProfile)
 *   data/users/<userId>/auth/password-hash.txt
 *   data/users/<userId>/auth/sessions.json   (UserSessions, see auth-middleware)
 *   data/users/<userId>/preferences.json
 *
 * Failed-login counter lives on the profile so it can be both
 * inspected by the admin Members UI and used by the auth middleware
 * to compute the lockout state. All increment/decrement paths go
 * through `withMutex(\`user-profile:\${userId}\`)` so 50 parallel
 * failed-login attempts produce an exact counter of 50, not 49 or 47
 * from a read-modify-write race (Plan-Finding F6).
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import { writeJsonAtomic, withMutex } from './atomic-write'
import { getDataDir, getUserDir, isValidSlug } from './data-paths'
import { assertSchemaVersion } from './json-schema-version'

export const USER_PROFILE_SCHEMA_VERSION = 1
export const FAILED_LOGIN_THRESHOLD = 10
export const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000

export type UserStatus = 'active' | 'disabled' | 'locked'

export type UserProfile = {
  schemaVersion: 1
  id: string
  email: string
  name: string
  createdAt: string
  defaultWorkspaceId?: string
  status: UserStatus
  failedLoginCount: number
  lastLoginAt?: string
  lastFailedLoginAt?: string
  lockedUntil?: string
  mustChangePassword?: boolean
}

function profilePath(userId: string): string {
  return join(getUserDir(userId), 'profile.json')
}

function passwordHashPath(userId: string): string {
  return join(getUserDir(userId), 'auth', 'password-hash.txt')
}

function userMutex(userId: string): string {
  return `user-profile:${userId}`
}

function ensureValidId(userId: string): void {
  if (!isValidSlug(userId)) {
    throw new Error(`[users-store] invalid userId: ${JSON.stringify(userId)}`)
  }
}

function readProfileSync(userId: string): UserProfile | null {
  ensureValidId(userId)
  const path = profilePath(userId)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return assertSchemaVersion<UserProfile>(raw, 1, path)
  } catch {
    return null
  }
}

export function getUserProfile(userId: string): UserProfile | null {
  return readProfileSync(userId)
}

export function listUsers(): Array<string> {
  const usersRoot = join(getDataDir(), 'users')
  if (!existsSync(usersRoot)) return []
  return readdirSync(usersRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isValidSlug(e.name))
    .map((e) => e.name)
    .sort()
}

export type CreateUserInput = {
  id: string
  email: string
  name: string
  status?: UserStatus
  mustChangePassword?: boolean
  defaultWorkspaceId?: string
}

/**
 * Create a new user profile. Throws if `id` already exists. Caller
 * must separately persist the password hash via `setPasswordHash`.
 */
export async function createUser(input: CreateUserInput): Promise<UserProfile> {
  ensureValidId(input.id)
  if (existsSync(profilePath(input.id))) {
    throw new Error(`[users-store] user already exists: ${input.id}`)
  }
  return withMutex(userMutex(input.id), async () => {
    const profile: UserProfile = {
      schemaVersion: 1,
      id: input.id,
      email: input.email,
      name: input.name,
      createdAt: new Date().toISOString(),
      status: input.status ?? 'active',
      failedLoginCount: 0,
      defaultWorkspaceId: input.defaultWorkspaceId,
      mustChangePassword: input.mustChangePassword ?? false,
    }
    mkdirSync(dirname(profilePath(input.id)), { recursive: true })
    writeJsonAtomic(profilePath(input.id), profile)
    return profile
  })
}

/**
 * Apply a partial patch to the profile under mutex. The patch
 * function receives the current profile (or `null` if missing) and
 * returns the new profile or `null` to leave it unchanged. Returns
 * the persisted profile after the patch.
 */
export async function updateUserProfile(
  userId: string,
  patch: (current: UserProfile | null) => UserProfile | null,
): Promise<UserProfile | null> {
  ensureValidId(userId)
  return withMutex(userMutex(userId), async () => {
    const current = readProfileSync(userId)
    const next = patch(current)
    if (next === null) return current
    if (next.id !== userId) {
      throw new Error(`[users-store] patch must not change userId`)
    }
    writeJsonAtomic(profilePath(userId), next)
    return next
  })
}

/**
 * Atomically increment failedLoginCount and return the new profile.
 * If the increment crosses the threshold within the window, sets
 * `status: 'locked'` and `lockedUntil = now + LOCKOUT_DURATION_MS`.
 */
export async function recordFailedLogin(userId: string): Promise<UserProfile | null> {
  return updateUserProfile(userId, (current) => {
    if (!current) return null
    const now = Date.now()
    const lastFail = current.lastFailedLoginAt
      ? new Date(current.lastFailedLoginAt).getTime()
      : 0
    const withinWindow = now - lastFail <= FAILED_LOGIN_WINDOW_MS
    const next: UserProfile = {
      ...current,
      failedLoginCount: withinWindow ? current.failedLoginCount + 1 : 1,
      lastFailedLoginAt: new Date(now).toISOString(),
    }
    if (next.failedLoginCount >= FAILED_LOGIN_THRESHOLD) {
      next.status = 'locked'
      next.lockedUntil = new Date(now + LOCKOUT_DURATION_MS).toISOString()
    }
    return next
  })
}

/**
 * Reset failedLoginCount to 0 on successful login. Also clears any
 * stale `lockedUntil` if the lockout window has expired.
 */
export async function recordSuccessfulLogin(userId: string): Promise<UserProfile | null> {
  return updateUserProfile(userId, (current) => {
    if (!current) return null
    const now = Date.now()
    return {
      ...current,
      failedLoginCount: 0,
      lastFailedLoginAt: undefined,
      lastLoginAt: new Date(now).toISOString(),
      status: current.status === 'locked' ? 'active' : current.status,
      lockedUntil: undefined,
    }
  })
}

/**
 * `true` when the user is currently locked AND the lockout window has
 * not yet expired. Stale lockouts (lockedUntil in the past) auto-clear
 * on next login attempt — see `recordSuccessfulLogin`.
 */
export function isUserLocked(profile: UserProfile): boolean {
  if (profile.status !== 'locked') return false
  if (!profile.lockedUntil) return true
  return Date.now() < new Date(profile.lockedUntil).getTime()
}

/**
 * Persist a bcrypt hash to `auth/password-hash.txt` (mode 0600).
 * The file is single-line; no JSON wrapper, so admin tooling can read
 * it without parsing.
 */
export async function setPasswordHash(userId: string, hash: string): Promise<void> {
  ensureValidId(userId)
  return withMutex(userMutex(userId), async () => {
    const path = passwordHashPath(userId)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, hash, { encoding: 'utf8', mode: 0o600 })
    try {
      chmodSync(path, 0o600)
    } catch {
      // chmod best-effort on Windows
    }
  })
}

export function getPasswordHash(userId: string): string | null {
  ensureValidId(userId)
  const path = passwordHashPath(userId)
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
}
