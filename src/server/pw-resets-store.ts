/**
 * Password-reset tokens.
 *
 * Two flavours, both stored under `data/global/pw-resets/<token>.json`:
 *
 *   - `temp-password` (admin-triggered) — admin generates a 12-char temp
 *     password for a member; we hash + store it server-side, hand the
 *     plaintext back to the admin EXACTLY ONCE in the API response.
 *     Member's existing sessions are invalidated, `mustChangePassword`
 *     is set on their profile, next login uses the temp PW and forces
 *     a change. TTL 24 h.
 *
 *   - `reset-link` (self-service forgot-password) — used once SMTP is
 *     wired up. Generates a long-lived reset link the user clicks to
 *     pick a new password. TTL 1 h.
 *
 * Plaintext temp-passwords are NEVER persisted anywhere — only the
 * bcrypt hash via `users-store.setPasswordHash`. The admin sees the
 * plaintext exactly once in the HTTP response.
 *
 * All writes are atomic + mutex-serialised.
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

import { writeJsonAtomic, withMutex } from './atomic-write'
import { getGlobalDir, isValidSlug } from './data-paths'
import { assertSchemaVersion } from './json-schema-version'

export const PW_RESET_SCHEMA_VERSION = 1
export const TEMP_PW_TTL_MS = 24 * 60 * 60 * 1000 // 24h
export const RESET_LINK_TTL_MS = 60 * 60 * 1000 // 1h

export type PwResetType = 'temp-password' | 'reset-link'

export type PasswordReset = {
  schemaVersion: 1
  token: string
  type: PwResetType
  userId: string
  triggeredBy: 'self' | 'admin'
  triggeredById?: string
  createdAt: string
  expiresAt: string
  used: boolean
  usedAt?: string
}

const TOKEN_RE = /^[a-f0-9]{64}$/

function ensureValidToken(token: string): void {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
    throw new Error(`[pw-resets-store] invalid token format`)
  }
}

function getResetsDir(): string {
  return join(getGlobalDir(), 'pw-resets')
}

function resetPath(token: string): string {
  return join(getResetsDir(), `${token}.json`)
}

function resetMutex(token: string): string {
  return `pw-reset:${token}`
}

export function generateResetToken(): string {
  return randomBytes(32).toString('hex')
}

export type CreateTempPwResetInput = {
  userId: string
  triggeredById: string
}

export type CreateResetLinkInput = {
  userId: string
}

export async function createTempPwReset(input: CreateTempPwResetInput): Promise<PasswordReset> {
  if (!isValidSlug(input.userId)) {
    throw new Error(`[pw-resets-store] invalid userId: ${JSON.stringify(input.userId)}`)
  }
  if (!isValidSlug(input.triggeredById)) {
    throw new Error(`[pw-resets-store] invalid triggeredById: ${JSON.stringify(input.triggeredById)}`)
  }
  const token = generateResetToken()
  const now = new Date()
  const reset: PasswordReset = {
    schemaVersion: 1,
    token,
    type: 'temp-password',
    userId: input.userId,
    triggeredBy: 'admin',
    triggeredById: input.triggeredById,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TEMP_PW_TTL_MS).toISOString(),
    used: false,
  }
  return withMutex(resetMutex(token), async () => {
    mkdirSync(dirname(resetPath(token)), { recursive: true })
    writeJsonAtomic(resetPath(token), reset)
    return reset
  })
}

export async function createResetLink(input: CreateResetLinkInput): Promise<PasswordReset> {
  if (!isValidSlug(input.userId)) {
    throw new Error(`[pw-resets-store] invalid userId: ${JSON.stringify(input.userId)}`)
  }
  const token = generateResetToken()
  const now = new Date()
  const reset: PasswordReset = {
    schemaVersion: 1,
    token,
    type: 'reset-link',
    userId: input.userId,
    triggeredBy: 'self',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + RESET_LINK_TTL_MS).toISOString(),
    used: false,
  }
  return withMutex(resetMutex(token), async () => {
    mkdirSync(dirname(resetPath(token)), { recursive: true })
    writeJsonAtomic(resetPath(token), reset)
    return reset
  })
}

export function getPwReset(token: string): PasswordReset | null {
  ensureValidToken(token)
  const path = resetPath(token)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return assertSchemaVersion<PasswordReset>(raw, 1, path)
  } catch {
    return null
  }
}

export function isPwResetValid(reset: PasswordReset): boolean {
  if (reset.used) return false
  if (Date.now() > new Date(reset.expiresAt).getTime()) return false
  return true
}

export async function consumePwReset(token: string): Promise<PasswordReset> {
  ensureValidToken(token)
  return withMutex(resetMutex(token), async () => {
    const current = getPwReset(token)
    if (!current) throw new Error(`[pw-resets-store] reset not found: ${token}`)
    if (current.used) throw new Error(`[pw-resets-store] reset already used`)
    if (Date.now() > new Date(current.expiresAt).getTime()) {
      throw new Error(`[pw-resets-store] reset expired`)
    }
    const next: PasswordReset = {
      ...current,
      used: true,
      usedAt: new Date().toISOString(),
    }
    writeJsonAtomic(resetPath(token), next)
    return next
  })
}

export async function revokePwReset(token: string): Promise<boolean> {
  ensureValidToken(token)
  return withMutex(resetMutex(token), async () => {
    const current = getPwReset(token)
    if (!current) return false
    try {
      unlinkSync(resetPath(token))
      return true
    } catch {
      return false
    }
  })
}
