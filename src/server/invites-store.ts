/**
 * Workspace-invite tokens.
 *
 * Layout: `data/global/invites/<token>.json`. One file per invite —
 * makes lookup by token O(1) without scanning a list, and lets a
 * pending invite be revoked simply by deleting the file.
 *
 * Lifecycle:
 *   - Admin creates an invite → writes <token>.json with `used: false`
 *   - Recipient opens `/invite/<token>` → `getInviteInfo(token)`
 *   - Recipient submits accept form → `consumeInvite(token, userId)` flips
 *     `used: true`, sets `usedBy/usedAt`. Subsequent reads still return
 *     the file but `used: true` so the UI can show "already used".
 *   - Admin can revoke pending invites → `revokeInvite(token)` deletes
 *     the file. A consumed invite is kept for audit purposes.
 *
 * Invariants enforced here:
 *   - Token is a hex string of 32 random bytes (64 chars). Anything
 *     else is rejected at the path layer because we hash-validate.
 *   - TTL is 7 days default, configurable per-invite.
 *   - Each invite is one-shot: `consumeInvite` on a consumed/expired
 *     token throws.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

import { writeJsonAtomic, withMutex } from './atomic-write'
import { getGlobalDir, isValidSlug } from './data-paths'
import { assertSchemaVersion } from './json-schema-version'

export const INVITE_SCHEMA_VERSION = 1
export const DEFAULT_INVITE_TTL_DAYS = 7

export type InviteRole = 'admin' | 'member'

export type Invite = {
  schemaVersion: 1
  token: string
  workspaceId: string
  email?: string
  role: InviteRole
  invitedBy: string
  createdAt: string
  expiresAt: string
  used: boolean
  usedBy?: string
  usedAt?: string
}

const TOKEN_RE = /^[a-f0-9]{64}$/

function ensureValidToken(token: string): void {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
    throw new Error(`[invites-store] invalid token format`)
  }
}

function getInvitesDir(): string {
  return join(getGlobalDir(), 'invites')
}

function invitePath(token: string): string {
  return join(getInvitesDir(), `${token}.json`)
}

function inviteMutex(token: string): string {
  return `invite:${token}`
}

export function generateInviteToken(): string {
  return randomBytes(32).toString('hex')
}

export type CreateInviteInput = {
  workspaceId: string
  email?: string
  role: InviteRole
  invitedBy: string
  ttlDays?: number
}

export async function createInvite(input: CreateInviteInput): Promise<Invite> {
  if (!isValidSlug(input.workspaceId)) {
    throw new Error(`[invites-store] invalid workspaceId: ${JSON.stringify(input.workspaceId)}`)
  }
  if (!isValidSlug(input.invitedBy)) {
    throw new Error(`[invites-store] invalid invitedBy: ${JSON.stringify(input.invitedBy)}`)
  }
  const token = generateInviteToken()
  const ttlDays = Math.max(1, Math.min(30, input.ttlDays ?? DEFAULT_INVITE_TTL_DAYS))
  const now = new Date()
  const expires = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000)
  const invite: Invite = {
    schemaVersion: 1,
    token,
    workspaceId: input.workspaceId,
    email: input.email,
    role: input.role,
    invitedBy: input.invitedBy,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    used: false,
  }
  return withMutex(inviteMutex(token), async () => {
    mkdirSync(dirname(invitePath(token)), { recursive: true })
    writeJsonAtomic(invitePath(token), invite)
    return invite
  })
}

export function getInvite(token: string): Invite | null {
  ensureValidToken(token)
  const path = invitePath(token)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return assertSchemaVersion<Invite>(raw, 1, path)
  } catch {
    return null
  }
}

export function isInviteValid(invite: Invite): boolean {
  if (invite.used) return false
  if (Date.now() > new Date(invite.expiresAt).getTime()) return false
  return true
}

/**
 * Mark the invite as consumed by `userId`. Throws if the invite is
 * already used or expired — the caller (HTTP route) maps that to 410.
 */
export async function consumeInvite(token: string, userId: string): Promise<Invite> {
  ensureValidToken(token)
  if (!isValidSlug(userId)) {
    throw new Error(`[invites-store] invalid userId: ${JSON.stringify(userId)}`)
  }
  return withMutex(inviteMutex(token), async () => {
    const current = getInvite(token)
    if (!current) throw new Error(`[invites-store] invite not found: ${token}`)
    if (current.used) throw new Error(`[invites-store] invite already used`)
    if (Date.now() > new Date(current.expiresAt).getTime()) {
      throw new Error(`[invites-store] invite expired`)
    }
    const next: Invite = {
      ...current,
      used: true,
      usedBy: userId,
      usedAt: new Date().toISOString(),
    }
    writeJsonAtomic(invitePath(token), next)
    return next
  })
}

/**
 * Delete a pending invite. No-op for already-consumed invites — those
 * are retained for audit. Returns true if a file was deleted.
 */
export async function revokeInvite(token: string): Promise<boolean> {
  ensureValidToken(token)
  return withMutex(inviteMutex(token), async () => {
    const current = getInvite(token)
    if (!current) return false
    if (current.used) return false
    try {
      unlinkSync(invitePath(token))
      return true
    } catch {
      return false
    }
  })
}

/**
 * List pending (not-yet-used, not-yet-expired) invites for a workspace.
 * Used by the Admin Members-tab to show a "Pending Invites" section.
 */
export function listPendingInvitesForWorkspace(workspaceId: string): Array<Invite> {
  if (!isValidSlug(workspaceId)) {
    throw new Error(`[invites-store] invalid workspaceId: ${JSON.stringify(workspaceId)}`)
  }
  const dir = getInvitesDir()
  if (!existsSync(dir)) return []
  const out: Array<Invite> = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const token = file.replace(/\.json$/, '')
    const inv = getInvite(token)
    if (!inv) continue
    if (inv.workspaceId !== workspaceId) continue
    if (!isInviteValid(inv)) continue
    out.push(inv)
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * Remove all expired invites. Cheap to call from a periodic boot-time
 * sweep. Returns the count of deleted files.
 */
export async function sweepExpiredInvites(): Promise<number> {
  const dir = getInvitesDir()
  if (!existsSync(dir)) return 0
  let deleted = 0
  const now = Date.now()
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const token = file.replace(/\.json$/, '')
    const inv = getInvite(token)
    if (!inv) continue
    if (inv.used) continue // keep consumed invites for audit
    if (now > new Date(inv.expiresAt).getTime()) {
      try {
        unlinkSync(invitePath(token))
        deleted++
      } catch {
        // best-effort sweep
      }
    }
  }
  return deleted
}
