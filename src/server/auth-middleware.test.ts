import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression tests for #123 (Secure cookie attribute) and #125
 * (x-forwarded-for spoofing).
 *
 * We reset the module between tests because the cookie helper captures
 * env-dependent state at call time and rate-limit / middleware paths
 * depend on `TRUST_PROXY`.
 */

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  delete process.env.COOKIE_SECURE
  delete process.env.NODE_ENV
  delete process.env.TRUST_PROXY
  delete process.env.CLAUDE_PASSWORD
})

describe('createSessionCookie (#123)', () => {
  it('omits Secure in development by default', async () => {
    process.env.NODE_ENV = 'development'
    const { createSessionCookie } = await import('./auth-middleware')
    const cookie = createSessionCookie('tok123')
    expect(cookie).toMatch(/^claude-auth=tok123/)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')
    expect(cookie).not.toContain('Secure')
  })

  it('sets Secure in production by default', async () => {
    process.env.NODE_ENV = 'production'
    const { createSessionCookie } = await import('./auth-middleware')
    const cookie = createSessionCookie('tok123')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('respects COOKIE_SECURE=1 override in development', async () => {
    process.env.NODE_ENV = 'development'
    process.env.COOKIE_SECURE = '1'
    const { createSessionCookie } = await import('./auth-middleware')
    const cookie = createSessionCookie('tok123')
    expect(cookie).toContain('Secure')
  })

  it('respects COOKIE_SECURE=0 override in production', async () => {
    process.env.NODE_ENV = 'production'
    process.env.COOKIE_SECURE = '0'
    const { createSessionCookie } = await import('./auth-middleware')
    const cookie = createSessionCookie('tok123')
    expect(cookie).not.toContain('Secure')
  })
})

describe('getRequestIp (#125)', () => {
  function makeRequest(headers: Record<string, string>): Request {
    return new Request('http://localhost/', { headers })
  }

  it('ignores x-forwarded-for when TRUST_PROXY is unset', async () => {
    delete process.env.TRUST_PROXY
    const { getRequestIp } = await import('./auth-middleware')
    const ip = getRequestIp(
      makeRequest({ 'x-forwarded-for': '203.0.113.77, 10.0.0.1' }),
    )
    expect(ip).toBe('127.0.0.1')
  })

  it('ignores x-real-ip when TRUST_PROXY is unset', async () => {
    delete process.env.TRUST_PROXY
    const { getRequestIp } = await import('./auth-middleware')
    const ip = getRequestIp(makeRequest({ 'x-real-ip': '203.0.113.77' }))
    expect(ip).toBe('127.0.0.1')
  })

  it('honors x-forwarded-for when TRUST_PROXY=1', async () => {
    process.env.TRUST_PROXY = '1'
    const { getRequestIp } = await import('./auth-middleware')
    const ip = getRequestIp(
      makeRequest({ 'x-forwarded-for': '203.0.113.77, 10.0.0.1' }),
    )
    expect(ip).toBe('203.0.113.77')
  })

  it('honors x-real-ip fallback when TRUST_PROXY=true and x-forwarded-for absent', async () => {
    process.env.TRUST_PROXY = 'true'
    const { getRequestIp } = await import('./auth-middleware')
    const ip = getRequestIp(makeRequest({ 'x-real-ip': '198.51.100.5' }))
    expect(ip).toBe('198.51.100.5')
  })
})

// ──────────────────────────────────────────────────────────────────────
// Phase A.2 — multi-tenant auth (Plan A.3 helpers)
// ──────────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function makeRequestWithCookie(opts: { cookie?: string; ip?: string } = {}): Request {
  const headers: Record<string, string> = {}
  if (opts.cookie) headers.cookie = opts.cookie
  const req = new Request('http://test/foo', { method: 'GET', headers })
  if (opts.ip) {
    Object.defineProperty(req, 'remoteAddress', { value: opts.ip })
  }
  return req
}

describe('multi-tenant auth (post-migration)', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    vi.resetModules()
    dataDir = mkdtempSync(join(tmpdir(), 'auth-mt-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
    delete process.env.HERMES_PASSWORD
    delete process.env.CLAUDE_PASSWORD
    process.env.HERMES_BCRYPT_COST = '10'

    const auth = await import('./auth-middleware')
    auth._resetAuthIndexForTests()

    const ws = await import('./workspace-store')
    ws._clearWorkspaceCachesForTests()

    const { writeMarker } = await import('./migration-marker')
    writeMarker()
    auth._resetAuthIndexForTests()

    const { createUser, setPasswordHash, updateUserProfile } = await import('./users-store')
    const { hashPassword } = await import('./auth-passwords')
    await createUser({ id: 'phil', email: 'phil@stratex-ai.com', name: 'Phil' })
    const hash = await hashPassword('correct horse')
    await setPasswordHash('phil', hash)

    await ws.createWorkspace({ id: 'stratex', name: 'Stratex', createdBy: 'phil' })
    await ws.addMember({ wsId: 'stratex', userId: 'phil', role: 'owner', addedBy: 'phil' })
    await updateUserProfile('phil', (p) => (p ? { ...p, defaultWorkspaceId: 'stratex' } : null))
  })

  afterEach(async () => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
    const auth = await import('./auth-middleware')
    auth._resetAuthIndexForTests()
    const ws = await import('./workspace-store')
    ws._clearWorkspaceCachesForTests()
  })

  it('isMultiTenantAuthEnabled returns true when marker is present', async () => {
    const { isMultiTenantAuthEnabled } = await import('./auth-middleware')
    expect(isMultiTenantAuthEnabled()).toBe(true)
  })

  it('loginWithEmailPassword: ok+token on correct credentials', async () => {
    const { loginWithEmailPassword } = await import('./auth-middleware')
    const result = await loginWithEmailPassword('phil@stratex-ai.com', 'correct horse', { ip: '1.2.3.4' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.userId).toBe('phil')
      expect(result.token).toMatch(/^[0-9a-f]{64}$/)
    }
  }, 15000)

  it('loginWithEmailPassword: case-insensitive email', async () => {
    const { loginWithEmailPassword } = await import('./auth-middleware')
    const result = await loginWithEmailPassword('Phil@Stratex-AI.com', 'correct horse')
    expect(result.ok).toBe(true)
  }, 15000)

  it('loginWithEmailPassword: invalid-credentials on wrong PW', async () => {
    const { loginWithEmailPassword } = await import('./auth-middleware')
    const result = await loginWithEmailPassword('phil@stratex-ai.com', 'wrong')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid-credentials')
  }, 10000)

  it('loginWithEmailPassword: no-such-user on unknown email', async () => {
    const { loginWithEmailPassword } = await import('./auth-middleware')
    const result = await loginWithEmailPassword('ghost@nowhere', 'x')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no-such-user')
  })

  it('failed login: 10× wrong → status locked, then login refused', async () => {
    const { loginWithEmailPassword } = await import('./auth-middleware')
    for (let i = 0; i < 10; i++) {
      await loginWithEmailPassword('phil@stratex-ai.com', 'wrong')
    }
    const result = await loginWithEmailPassword('phil@stratex-ai.com', 'correct horse')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('locked')
  }, 30000)

  it('successful login emits a global audit event with IP', async () => {
    const { loginWithEmailPassword } = await import('./auth-middleware')
    await loginWithEmailPassword('phil@stratex-ai.com', 'correct horse', { ip: '9.8.7.6' })
    const fs = await import('node:fs')
    const day = new Date().toISOString().slice(0, 10)
    const auditPath = join(dataDir, 'global', 'audit', `${day}.jsonl`)
    const lines = fs.readFileSync(auditPath, 'utf8').split('\n').filter((l) => l.length > 0)
    const events = lines.map((l) => JSON.parse(l))
    const login = events.find((e) => e.type === 'login')
    expect(login).toBeDefined()
    expect(login.userId).toBe('phil')
    expect(login.ip).toBe('9.8.7.6')
  }, 15000)

  it('failed login emits audit with reason+IP (L7)', async () => {
    const { loginWithEmailPassword } = await import('./auth-middleware')
    await loginWithEmailPassword('phil@stratex-ai.com', 'wrong', { ip: '1.1.1.1' })
    const fs = await import('node:fs')
    const day = new Date().toISOString().slice(0, 10)
    const auditPath = join(dataDir, 'global', 'audit', `${day}.jsonl`)
    const lines = fs.readFileSync(auditPath, 'utf8').split('\n').filter((l) => l.length > 0)
    const events = lines.map((l) => JSON.parse(l))
    const failed = events.find((e) => e.type === 'login_failed')
    expect(failed).toBeDefined()
    expect(failed.reason).toBe('invalid-credentials')
    expect(failed.ip).toBe('1.1.1.1')
  }, 10000)

  it('issueUserSessionToken + lookupUserIdByToken round-trips', async () => {
    const { issueUserSessionToken, lookupUserIdByToken } = await import('./auth-middleware')
    const token = await issueUserSessionToken({ userId: 'phil' })
    expect(lookupUserIdByToken(token)).toBe('phil')
  })

  it('revokeUserSessionToken invalidates the token', async () => {
    const { issueUserSessionToken, lookupUserIdByToken, revokeUserSessionToken } = await import('./auth-middleware')
    const token = await issueUserSessionToken({ userId: 'phil' })
    await revokeUserSessionToken(token)
    expect(lookupUserIdByToken(token)).toBeNull()
  })

  it('revokeAllUserSessionTokens invalidates every active token', async () => {
    const { issueUserSessionToken, lookupUserIdByToken, revokeAllUserSessionTokens } = await import('./auth-middleware')
    const a = await issueUserSessionToken({ userId: 'phil' })
    const b = await issueUserSessionToken({ userId: 'phil' })
    await revokeAllUserSessionTokens('phil')
    expect(lookupUserIdByToken(a)).toBeNull()
    expect(lookupUserIdByToken(b)).toBeNull()
  })

  it('AK26: 1000 tokens, lookup p99 < 5ms', async () => {
    const { issueUserSessionToken, lookupUserIdByToken } = await import('./auth-middleware')
    const tokens: Array<string> = []
    for (let i = 0; i < 1000; i++) {
      tokens.push(await issueUserSessionToken({ userId: 'phil' }))
    }
    const samples: Array<number> = []
    for (let i = 0; i < 10000; i++) {
      const t = tokens[i % tokens.length]
      const start = process.hrtime.bigint()
      lookupUserIdByToken(t)
      samples.push(Number(process.hrtime.bigint() - start) / 1e6)
    }
    samples.sort((x, y) => x - y)
    const p99 = samples[Math.floor(samples.length * 0.99)]
    expect(p99).toBeLessThan(5)
  }, 60000)

  it('requireUser: ok with valid cookie', async () => {
    const { issueUserSessionToken, requireUser } = await import('./auth-middleware')
    const token = await issueUserSessionToken({ userId: 'phil' })
    const r = requireUser(makeRequestWithCookie({ cookie: `claude-auth=${token}` }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.id).toBe('phil')
  })

  it('requireUser: 401 without cookie', async () => {
    const { requireUser } = await import('./auth-middleware')
    const r = requireUser(makeRequestWithCookie())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(401)
  })

  it('requireUser: 403 when user is disabled', async () => {
    const auth = await import('./auth-middleware')
    const { updateUserProfile } = await import('./users-store')
    await updateUserProfile('phil', (p) => (p ? { ...p, status: 'disabled' } : null))
    const token = await auth.issueUserSessionToken({ userId: 'phil' })
    const r = auth.requireUser(makeRequestWithCookie({ cookie: `claude-auth=${token}` }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(403)
  })

  it('requireWorkspaceMember: 404 for soft-deleted ws', async () => {
    const auth = await import('./auth-middleware')
    const ws = await import('./workspace-store')
    await ws.softDeleteWorkspace('stratex', 'phil')
    const token = await auth.issueUserSessionToken({ userId: 'phil' })
    const r = auth.requireWorkspaceMember(
      makeRequestWithCookie({ cookie: `claude-auth=${token}` }),
      'stratex',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(404)
  })

  it('requireWorkspaceMember: 404 for non-member (F9 cross-ws-isolation)', async () => {
    const auth = await import('./auth-middleware')
    const { createUser, setPasswordHash } = await import('./users-store')
    const { hashPassword } = await import('./auth-passwords')
    await createUser({ id: 'partner', email: 'p@x.y', name: 'P' })
    await setPasswordHash('partner', await hashPassword('hunter2'))
    const token = await auth.issueUserSessionToken({ userId: 'partner' })
    const r = auth.requireWorkspaceMember(
      makeRequestWithCookie({ cookie: `claude-auth=${token}` }),
      'stratex',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(404)
  }, 10000)

  it('requirePermission: owner can workspace-delete', async () => {
    const auth = await import('./auth-middleware')
    const token = await auth.issueUserSessionToken({ userId: 'phil' })
    const r = auth.requirePermission(
      makeRequestWithCookie({ cookie: `claude-auth=${token}` }),
      'stratex',
      'workspace-delete',
    )
    expect(r.ok).toBe(true)
  })

  it('requirePermission: member CANNOT workspace-delete (403)', async () => {
    const auth = await import('./auth-middleware')
    const ws = await import('./workspace-store')
    const { createUser, setPasswordHash } = await import('./users-store')
    const { hashPassword } = await import('./auth-passwords')
    await createUser({ id: 'm1', email: 'm1@x.y', name: 'M' })
    await setPasswordHash('m1', await hashPassword('hunter2'))
    await ws.addMember({ wsId: 'stratex', userId: 'm1', role: 'member', addedBy: 'phil' })
    const token = await auth.issueUserSessionToken({ userId: 'm1' })
    const r = auth.requirePermission(
      makeRequestWithCookie({ cookie: `claude-auth=${token}` }),
      'stratex',
      'workspace-delete',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(403)
  }, 10000)
})
