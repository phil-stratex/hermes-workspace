/**
 * bcrypt password hashing + verification.
 *
 * Cost factor (saltRounds) is configurable via `HERMES_BCRYPT_COST`,
 * default 12. Range is clamped to [10, 14] — below 10 is too weak for
 * 2026, above 14 hits perceptible login latency on a typical VPS.
 *
 * Uses `bcryptjs` (pure JS, no native deps) so the workspace ships
 * without compile-time toolchain requirements. Slightly slower than
 * native `bcrypt`, but cost-12 still measures ~250 ms per verify on
 * the Hostinger KVM 4 — acceptable for interactive login.
 */

import { randomFillSync } from 'node:crypto'

import bcrypt from 'bcryptjs'

const DEFAULT_COST = 12
const MIN_COST = 10
const MAX_COST = 14

export function getBcryptCost(): number {
  const raw = process.env.HERMES_BCRYPT_COST
  if (!raw) return DEFAULT_COST
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) return DEFAULT_COST
  return Math.max(MIN_COST, Math.min(MAX_COST, n))
}

/**
 * Hash a password with bcrypt. Returns a self-contained hash string
 * (algorithm + cost + salt + hash, the standard `$2b$...` format).
 */
export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('[auth-passwords] password must be a non-empty string')
  }
  return bcrypt.hash(plain, getBcryptCost())
}

/**
 * Compare a candidate password against a stored hash. Always
 * timing-safe (bcrypt's compare does the constant-time work
 * internally). Returns false on any malformed-hash error so a corrupt
 * record can't crash the login route.
 */
export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  if (typeof plain !== 'string' || plain.length === 0) return false
  if (typeof hashed !== 'string' || hashed.length === 0) return false
  try {
    return await bcrypt.compare(plain, hashed)
  } catch {
    return false
  }
}

/**
 * Inspect a stored hash for the cost factor it was created with.
 * Lets a future re-hash-on-login routine bump weak hashes when the
 * configured cost rises.
 */
export function getCostFromHash(hashed: string): number | null {
  // bcrypt format: $2a$<cost>$<salt><hash> or $2b$ / $2y$
  const match = /^\$2[aby]\$(\d{2})\$/.exec(hashed)
  if (!match) return null
  return Number.parseInt(match[1], 10)
}

/**
 * Generate a random temporary password (used by admin PW-reset).
 * 12 chars from an alphabet that avoids look-alikes (no l, 1, O, 0).
 */
export function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*'
  const buf = new Uint8Array(12)
  randomFillSync(buf)
  const out: Array<string> = []
  for (let i = 0; i < buf.length; i++) {
    out.push(alphabet[buf[i] % alphabet.length])
  }
  return out.join('')
}
