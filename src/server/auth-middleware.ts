import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { writeJsonAtomic, withMutex } from './atomic-write'
import { getDataDir, getUserDir, isValidSlug } from './data-paths'
import { assertSchemaVersion } from './json-schema-version'
import { logger } from './logger'
import { isMigrationCompleted } from './migration-marker'
import {
  getPasswordHash,
  getUserProfile,
  isUserLocked,
  listUsers,
  recordFailedLogin,
  recordSuccessfulLogin,
} from './users-store'
import type { UserProfile } from './users-store'
import { verifyPassword as bcryptVerify } from './auth-passwords'
import { canDo } from './permissions'
import { getMember, getWorkspaceMeta, isWorkspaceActive } from './workspace-store'
import { appendAuditEvent } from './audit-log'
import type { Action } from './permissions'

// ──────────────────────────────────────────────────────────────────────
// Modes
//
// Two parallel auth modes coexist during the rollout:
//
//   Legacy   — single HERMES_PASSWORD, no user identity. Used until
//              the multi-tenant migration has run (`isMigrationCompleted()
//              === false`). The original isAuthenticated() and the
//              flat ~/.hermes/workspace-sessions.json store still work,
//              so existing routes that haven't migrated keep working.
//
//   MultiTenant — email + bcrypt password. Tokens map to a userId.
//              Active workspace is part of the user profile. This is
//              the path taken once `isMigrationCompleted() === true`.
//
// L5 — `isAuthenticated`, `verifyPassword(password)`, `storeSessionToken`,
//      `revokeSessionToken` are kept as @deprecated wrappers so the 178
//      existing routes don't all have to flip on day one. New routes
//      use `requireUser`/`requirePermission`/`requireWorkspaceMember`.
//
// D3 — Once `isMigrationCompleted() === true`, the legacy single-PW
//      path stops accepting logins. HERMES_PASSWORD is migrated into
//      the owner's bcrypt hash and then ignored.
// ──────────────────────────────────────────────────────────────────────

export function isMultiTenantAuthEnabled(): boolean {
  return isMigrationCompleted()
}

// ─── Legacy session store (pre-migration only) ────────────────────────

interface LegacySessionStore {
  tokens: Record<string, number>
}

const LEGACY_STORE_FILE = join(
  process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? join(homedir(), '.hermes'),
  'workspace-sessions.json',
)
const LEGACY_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

function loadLegacyStore(): LegacySessionStore {
  try {
    if (existsSync(LEGACY_STORE_FILE)) {
      const parsed = JSON.parse(readFileSync(LEGACY_STORE_FILE, 'utf8')) as LegacySessionStore
      const now = Date.now()
      const valid: Record<string, number> = {}
      for (const [token, expiry] of Object.entries(parsed.tokens)) {
        if (expiry > now) valid[token] = expiry
      }
      return { tokens: valid }
    }
  } catch {
    // corrupt — start fresh
  }
  return { tokens: {} }
}

function saveLegacyStore(store: LegacySessionStore): void {
  try {
    const dir = dirname(LEGACY_STORE_FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(LEGACY_STORE_FILE, JSON.stringify(store), { encoding: 'utf8', mode: 0o600 })
    try {
      chmodSync(LEGACY_STORE_FILE, 0o600)
    } catch {
      // best-effort
    }
  } catch {
    console.warn(`[auth] Failed to persist legacy session store to ${LEGACY_STORE_FILE}`)
  }
}

const _legacyTokens = new Map<string, number>()
{
  const initial = loadLegacyStore()
  for (const [t, e] of Object.entries(initial.tokens)) _legacyTokens.set(t, e)
}

function legacyPersist(): void {
  saveLegacyStore({ tokens: Object.fromEntries(_legacyTokens) })
}

setInterval(() => {
  const now = Date.now()
  let changed = false
  for (const [t, e] of _legacyTokens) {
    if (e <= now) {
      _legacyTokens.delete(t)
      changed = true
    }
  }
  if (changed) legacyPersist()
}, 10 * 60 * 1000)

// ─── Multi-tenant session store (post-migration) ──────────────────────

export const USER_SESSIONS_SCHEMA_VERSION = 1
const USER_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type UserSessionRecord = {
  token: string
  issuedAt: string
  expiresAt: string
  userAgent?: string
  ip?: string
}

export type UserSessions = {
  schemaVersion: 1
  sessions: Array<UserSessionRecord>
}

function userSessionsPath(userId: string): string {
  return join(getUserDir(userId), 'auth', 'sessions.json')
}

function userSessionsMutex(userId: string): string {
  return `user-sessions:${userId}`
}

function readUserSessions(userId: string): UserSessions {
  const path = userSessionsPath(userId)
  if (!existsSync(path)) return { schemaVersion: 1, sessions: [] }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return assertSchemaVersion<UserSessions>(raw, 1, path)
  } catch {
    return { schemaVersion: 1, sessions: [] }
  }
}

/**
 * Token → userId in-memory index for O(1) auth checks (Plan AK26: p99
 * < 5 ms at 1000 tokens). Hydrated from disk on first access.
 */
const _tokenIndex = new Map<string, { userId: string; expiresAt: number }>()
let _tokenIndexHydrated = false

function hydrateTokenIndex(): void {
  if (_tokenIndexHydrated) return
  const usersRoot = join(getDataDir(), 'users')
  if (existsSync(usersRoot)) {
    for (const userId of listUsers()) {
      const sessions = readUserSessions(userId)
      const now = Date.now()
      for (const s of sessions.sessions) {
        const expiresAt = new Date(s.expiresAt).getTime()
        if (expiresAt > now) {
          _tokenIndex.set(s.token, { userId, expiresAt })
        }
      }
    }
  }
  _tokenIndexHydrated = true
}

/**
 * Test-only: drop all in-memory index state. Lets a fixture-using test
 * start with a known clean index per case.
 */
export function _resetAuthIndexForTests(): void {
  _tokenIndex.clear()
  _tokenIndexHydrated = false
  _legacyTokens.clear()
  // Suppress unused warning for readdirSync (kept for symmetry / future use)
  void readdirSync
}

// ─── Public token API (multi-tenant) ──────────────────────────────────

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

export type IssueTokenInput = {
  userId: string
  ip?: string
  userAgent?: string
}

export async function issueUserSessionToken(input: IssueTokenInput): Promise<string> {
  if (!isValidSlug(input.userId)) {
    throw new Error(`[auth] invalid userId: ${JSON.stringify(input.userId)}`)
  }
  const token = generateSessionToken()
  const now = Date.now()
  const expiresAt = now + USER_TOKEN_TTL_MS
  const record: UserSessionRecord = {
    token,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    userAgent: input.userAgent,
    ip: input.ip,
  }
  await withMutex(userSessionsMutex(input.userId), async () => {
    const current = readUserSessions(input.userId)
    const next: UserSessions = {
      schemaVersion: 1,
      sessions: [
        ...current.sessions.filter((s) => new Date(s.expiresAt).getTime() > now),
        record,
      ],
    }
    mkdirSync(dirname(userSessionsPath(input.userId)), { recursive: true })
    writeJsonAtomic(userSessionsPath(input.userId), next)
  })
  hydrateTokenIndex()
  _tokenIndex.set(token, { userId: input.userId, expiresAt })
  return token
}

export async function revokeUserSessionToken(token: string): Promise<void> {
  hydrateTokenIndex()
  const entry = _tokenIndex.get(token)
  if (!entry) return
  _tokenIndex.delete(token)
  await withMutex(userSessionsMutex(entry.userId), async () => {
    const current = readUserSessions(entry.userId)
    const next: UserSessions = {
      schemaVersion: 1,
      sessions: current.sessions.filter((s) => s.token !== token),
    }
    writeJsonAtomic(userSessionsPath(entry.userId), next)
  })
}

export async function revokeAllUserSessionTokens(userId: string): Promise<void> {
  if (!isValidSlug(userId)) return
  hydrateTokenIndex()
  for (const [t, entry] of _tokenIndex) {
    if (entry.userId === userId) _tokenIndex.delete(t)
  }
  await withMutex(userSessionsMutex(userId), async () => {
    const next: UserSessions = { schemaVersion: 1, sessions: [] }
    if (existsSync(userSessionsPath(userId))) {
      writeJsonAtomic(userSessionsPath(userId), next)
    }
  })
}

export function lookupUserIdByToken(token: string): string | null {
  hydrateTokenIndex()
  const entry = _tokenIndex.get(token)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    _tokenIndex.delete(token)
    return null
  }
  return entry.userId
}

// ─── Cookie + IP helpers (carried over from legacy) ───────────────────

export function getSessionTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const cookies = cookieHeader.split(';').map((c) => c.trim())
  for (const cookie of cookies) {
    if (cookie.startsWith('claude-auth=')) {
      return cookie.substring('claude-auth='.length)
    }
  }
  return null
}

function isTrustedProxyEnabled(): boolean {
  const v = (process.env.TRUST_PROXY || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export function getRequestIp(request: Request): string {
  if (isTrustedProxyEnabled()) {
    const forwarded = request.headers.get('x-forwarded-for')
    const first = forwarded?.split(',')[0]?.trim()
    if (first) return first
    const real = request.headers.get('x-real-ip')?.trim()
    if (real) return real
  }
  const maybeAddress = (request as unknown as { remoteAddress?: string }).remoteAddress
  return (maybeAddress && maybeAddress.trim()) || '127.0.0.1'
}

function isLocalRequest(request: Request): boolean {
  const ip = getRequestIp(request)
  const localIPs = ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']
  if (localIPs.includes(ip)) return true
  if (/^100\.\d+\.\d+\.\d+$/.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  if (/^10\./.test(ip)) return true
  return false
}

function shouldSetSecureCookie(): boolean {
  const override = (process.env.COOKIE_SECURE || '').trim().toLowerCase()
  if (override === '1' || override === 'true' || override === 'yes') return true
  if (override === '0' || override === 'false' || override === 'no') return false
  return process.env.NODE_ENV === 'production'
}

export function createSessionCookie(token: string): string {
  const attrs = ['HttpOnly']
  if (shouldSetSecureCookie()) attrs.push('Secure')
  attrs.push('SameSite=Strict', 'Path=/', `Max-Age=${30 * 24 * 60 * 60}`)
  return `claude-auth=${token}; ${attrs.join('; ')}`
}

export function clearSessionCookie(): string {
  const attrs = ['HttpOnly']
  if (shouldSetSecureCookie()) attrs.push('Secure')
  attrs.push('SameSite=Strict', 'Path=/', 'Max-Age=0')
  return `claude-auth=; ${attrs.join('; ')}`
}

// ─── Multi-tenant: login + permission helpers ─────────────────────────

export type LoginResult =
  | { ok: true; userId: string; token: string }
  | { ok: false; reason: 'invalid-credentials' | 'locked' | 'disabled' | 'no-such-user' }

/**
 * Verify an email + password against the user store. Records the
 * attempt (failure increments the lockout counter, success resets it
 * and emits an audit event). Caller is responsible for setting the
 * cookie via `createSessionCookie(result.token)`.
 */
export async function loginWithEmailPassword(
  emailOrId: string,
  plain: string,
  ctx: { ip?: string; userAgent?: string } = {},
): Promise<LoginResult> {
  const trimmed = emailOrId.trim()
  const lower = trimmed.toLowerCase()
  // Accept either an email (contains "@") or a userId-slug. Branch
  // here so a stack with userId="phil" + email="phil@stratex-ai.com"
  // can be reached either way.
  let userId: string | undefined
  if (trimmed.includes('@')) {
    userId = listUsers().find((id) => {
      const profile = getUserProfile(id)
      return profile?.email.toLowerCase() === lower
    })
  } else if (isValidSlug(lower)) {
    userId = listUsers().includes(lower) ? lower : undefined
  }
  if (!userId) {
    await appendAuditEvent('global', {
      type: 'login_failed',
      reason: 'no-such-user',
      identifier: lower,
      ip: ctx.ip ?? 'unknown',
      userAgent: ctx.userAgent,
    })
    // Mirror to the error-log so brute-force-style activity surfaces
    // there too — audit is the business-event, error-log holds the
    // technical context for trouble-shooting (`identifier` is the typed
    // input; we redact via the standard pipe).
    logger.warn('login failed', {
      source: 'auth',
      reason: 'no-such-user',
      identifier: lower,
      ip: ctx.ip ?? 'unknown',
      userAgent: ctx.userAgent,
    })
    return { ok: false, reason: 'no-such-user' }
  }
  const profile = getUserProfile(userId)!
  if (profile.status === 'disabled') {
    await appendAuditEvent('global', {
      type: 'login_failed',
      reason: 'disabled',
      userId,
      ip: ctx.ip ?? 'unknown',
    })
    logger.warn('login failed', {
      source: 'auth',
      reason: 'disabled',
      userId,
      ip: ctx.ip ?? 'unknown',
    })
    return { ok: false, reason: 'disabled' }
  }
  if (isUserLocked(profile)) {
    await appendAuditEvent('global', {
      type: 'login_failed',
      reason: 'locked',
      userId,
      ip: ctx.ip ?? 'unknown',
    })
    logger.warn('login failed', {
      source: 'auth',
      reason: 'locked',
      userId,
      ip: ctx.ip ?? 'unknown',
      lockedUntil: profile.lockedUntil,
    })
    return { ok: false, reason: 'locked' }
  }
  const hash = getPasswordHash(userId)
  const valid = hash ? await bcryptVerify(plain, hash) : false
  if (!valid) {
    const updated = await recordFailedLogin(userId)
    await appendAuditEvent('global', {
      type: 'login_failed',
      reason: 'invalid-credentials',
      userId,
      ip: ctx.ip ?? 'unknown',
      userAgent: ctx.userAgent,
    })
    logger.warn('login failed', {
      source: 'auth',
      reason: 'invalid-credentials',
      userId,
      ip: ctx.ip ?? 'unknown',
      userAgent: ctx.userAgent,
      failedLoginCount: updated?.failedLoginCount,
    })
    // If the failed attempt crossed the lockout threshold, surface a
    // separate fatal-ish entry so an operator scrolling the error-log
    // sees the lockout itself, not just the increment.
    if (updated && updated.status === 'locked' && profile.status !== 'locked') {
      logger.warn('user locked out after failed-login burst', {
        source: 'auth',
        userId,
        ip: ctx.ip ?? 'unknown',
        lockedUntil: updated.lockedUntil,
        failedLoginCount: updated.failedLoginCount,
      })
    }
    return { ok: false, reason: 'invalid-credentials' }
  }
  await recordSuccessfulLogin(userId)
  const token = await issueUserSessionToken({ userId, ip: ctx.ip, userAgent: ctx.userAgent })
  await appendAuditEvent('global', {
    type: 'login',
    userId,
    ip: ctx.ip ?? 'unknown',
    userAgent: ctx.userAgent,
  })
  return { ok: true, userId, token }
}

export function getCurrentUser(request: Request): UserProfile | null {
  if (!isMultiTenantAuthEnabled()) return null
  const token = getSessionTokenFromCookie(request.headers.get('cookie'))
  if (!token) return null
  const userId = lookupUserIdByToken(token)
  if (!userId) return null
  return getUserProfile(userId)
}

export function getActiveWorkspace(request: Request): string | null {
  const user = getCurrentUser(request)
  if (!user) return null
  return user.defaultWorkspaceId ?? null
}

// ─── Standard error responses ─────────────────────────────────────────

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

const RES_UNAUTHORIZED = () =>
  jsonResponse({ ok: false, error: 'Unauthorized' }, 401)
const RES_FORBIDDEN = (reason?: string) =>
  jsonResponse({ ok: false, error: 'Forbidden', reason }, 403)
const RES_NOT_FOUND = () =>
  jsonResponse({ ok: false, error: 'Not Found' }, 404)

export type RequireResult<T> = { ok: true; value: T } | { ok: false; response: Response }

/**
 * Resolve the request to a logged-in user. Returns either the user or
 * a ready-to-return 401 Response. Callers do:
 *   const auth = requireUser(req); if (!auth.ok) return auth.response
 */
export function requireUser(request: Request): RequireResult<UserProfile> {
  const user = getCurrentUser(request)
  if (!user) return { ok: false, response: RES_UNAUTHORIZED() }
  if (user.status !== 'active') return { ok: false, response: RES_FORBIDDEN('user-status:' + user.status) }
  return { ok: true, value: user }
}

/**
 * `requireUser` plus an existing-and-active workspace + member check.
 * Returns 404 when the workspace is missing or soft-deleted (don't
 * leak existence to non-members). Returns 403 when the user is not a
 * member.
 */
export function requireWorkspaceMember(
  request: Request,
  wsId: string,
): RequireResult<{ user: UserProfile; wsId: string }> {
  const auth = requireUser(request)
  if (!auth.ok) return auth
  if (!isValidSlug(wsId)) return { ok: false, response: RES_NOT_FOUND() }
  const meta = getWorkspaceMeta(wsId)
  if (!isWorkspaceActive(meta)) return { ok: false, response: RES_NOT_FOUND() }
  const member = getMember(wsId, auth.value.id)
  if (!member) return { ok: false, response: RES_NOT_FOUND() }
  return { ok: true, value: { user: auth.value, wsId } }
}

/**
 * `requireWorkspaceMember` plus a `canDo()` check for `action`. The
 * gold-standard guard for any mutating workspace endpoint.
 */
export function requirePermission(
  request: Request,
  wsId: string,
  action: Action,
): RequireResult<{ user: UserProfile; wsId: string }> {
  const member = requireWorkspaceMember(request, wsId)
  if (!member.ok) return member
  if (!canDo(member.value.user.id, wsId, action)) {
    return { ok: false, response: RES_FORBIDDEN(`action:${action}`) }
  }
  return member
}

// ─── Legacy helpers (DEPRECATED — kept for incremental route migration, L5) ──

/**
 * @deprecated Multi-tenant routes should use `lookupUserIdByToken` plus
 * `requireUser`. Kept to keep pre-migration single-PW deployments
 * working until every route has flipped to the new helpers. Once the
 * migration marker is set, this function only checks the multi-tenant
 * index.
 */
export function isValidSessionToken(token: string): boolean {
  if (isMultiTenantAuthEnabled()) return lookupUserIdByToken(token) !== null
  // Legacy path
  const expiry = _legacyTokens.get(token)
  if (expiry === undefined) return false
  if (expiry <= Date.now()) {
    _legacyTokens.delete(token)
    legacyPersist()
    return false
  }
  return true
}

/**
 * @deprecated Use `issueUserSessionToken` (with a real userId) for new
 * code. Kept so the legacy auth.ts route can keep accepting
 * HERMES_PASSWORD logins until the migration runs.
 */
export function storeSessionToken(token: string): void {
  if (isMultiTenantAuthEnabled()) {
    throw new Error(
      '[auth] storeSessionToken is legacy-only — call issueUserSessionToken with a userId',
    )
  }
  _legacyTokens.set(token, Date.now() + LEGACY_TOKEN_TTL_MS)
  legacyPersist()
}

/**
 * @deprecated Use `revokeUserSessionToken` in multi-tenant code.
 */
export function revokeSessionToken(token: string): void {
  if (isMultiTenantAuthEnabled()) {
    void revokeUserSessionToken(token)
    return
  }
  _legacyTokens.delete(token)
  legacyPersist()
}

function getConfiguredPassword(): string {
  // After the migration marker is set (D3), the env-password is dead —
  // ignored even if still present in the environment. Recovery goes
  // through the CLI tools (scripts/admin/reset-password.ts).
  if (isMultiTenantAuthEnabled()) return ''
  const fromHermes = process.env.HERMES_PASSWORD
  if (fromHermes && fromHermes.length > 0) return fromHermes
  const fromClaude = process.env.CLAUDE_PASSWORD
  if (fromClaude && fromClaude.length > 0) return fromClaude
  return ''
}

export function isPasswordProtectionEnabled(): boolean {
  if (isMultiTenantAuthEnabled()) return true
  return getConfiguredPassword().length > 0
}

/**
 * @deprecated Single-arg, single-PW. Use `loginWithEmailPassword`. Once
 * `isMultiTenantAuthEnabled()`, this always returns false.
 */
export function verifyPassword(password: string): boolean {
  const configured = getConfiguredPassword()
  if (!configured || configured.length === 0) return false
  const passwordBuf = Buffer.from(password, 'utf8')
  const configuredBuf = Buffer.from(configured, 'utf8')
  if (passwordBuf.length !== configuredBuf.length) return false
  try {
    return timingSafeEqual(passwordBuf, configuredBuf)
  } catch {
    return false
  }
}

/**
 * @deprecated Use `requireUser`. Returns true under the legacy PW flow
 * (no user identity) or when a multi-tenant token is present and
 * resolvable. Do NOT use as a permission check — it doesn't tell you
 * who the user is.
 */
export function isAuthenticated(request: Request): boolean {
  if (isMultiTenantAuthEnabled()) {
    const token = getSessionTokenFromCookie(request.headers.get('cookie'))
    if (!token) return false
    return lookupUserIdByToken(token) !== null
  }
  if (!isPasswordProtectionEnabled()) return true
  const token = getSessionTokenFromCookie(request.headers.get('cookie'))
  if (!token) return false
  return isValidSessionToken(token)
}

export function requireLocalOrAuth(request: Request): boolean {
  if (!isPasswordProtectionEnabled()) return isLocalRequest(request)
  return isAuthenticated(request)
}
