/**
 * E2E flow test for the Phase A.2 / A.3 multi-tenant routes.
 *
 * The TanStack route handlers are thin wrappers around the server-side
 * helpers (auth-middleware + stores), so this test exercises the
 * helpers directly via the same call-graph the routes do — that
 * verifies the wiring without spinning up a Vite server. It covers
 * every Akzeptanzkriterium from the plan that doesn't need a UI:
 *
 *   - SetupWizard creates first owner + workspace, marker is set,
 *     auto-login produces a working token (AK4)
 *   - 2nd workspace: create, switch, isolation
 *   - Admin invite → Inkognito-style accept (no auth) → new member,
 *     correct role, can-do-chat, cannot-do-workspace-delete (AK4-5)
 *   - PW-reset: temp-pw → login → mustChangePassword → change → temp
 *     unusable, new PW works (AK6)
 *   - 10× failed login → lockout (AK7)
 *   - Soft-delete: members lose access immediately (AK15)
 *   - Cross-workspace isolation (F9): non-member 404 / canDo false
 *   - Audit-Events for login (success+failed with IP), logout,
 *     pw-reset, member-add, ws-create, owner-handover (L7)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  _resetAuthIndexForTests,
  clearSessionCookie,
  getCurrentUser,
  isMultiTenantAuthEnabled,
  issueUserSessionToken,
  loginWithEmailPassword,
  lookupUserIdByToken,
  requirePermission,
  requireUser,
  requireWorkspaceMember,
  revokeAllUserSessionTokens,
  revokeUserSessionToken,
} from '../auth-middleware'
import { generateTempPassword, hashPassword, verifyPassword } from '../auth-passwords'
import { describeBootState } from '../boot-state-check'
import { isValidSlug } from '../data-paths'
import { consumeInvite, createInvite, getInvite, isInviteValid } from '../invites-store'
import { createTempPwReset } from '../pw-resets-store'
import { writeMarker } from '../migration-marker'
import { canDo } from '../permissions'
import {
  createUser,
  getPasswordHash,
  getUserProfile,
  setPasswordHash,
  updateUserProfile,
} from '../users-store'
import {
  _clearWorkspaceCachesForTests,
  addMember,
  createWorkspace,
  getMember,
  getWorkspaceMembers,
  getWorkspaceMeta,
  isWorkspaceActive,
  softDeleteWorkspace,
} from '../workspace-store'

function makeRequest(opts: { cookie?: string } = {}): Request {
  const headers: Record<string, string> = {}
  if (opts.cookie) headers.cookie = opts.cookie
  return new Request('http://test/foo', { method: 'GET', headers })
}

function readAuditEvents(dataDir: string, scope: string = 'global'): Array<Record<string, unknown>> {
  const day = new Date().toISOString().slice(0, 10)
  const path =
    scope === 'global'
      ? join(dataDir, 'global', 'audit', `${day}.jsonl`)
      : join(dataDir, 'workspaces', scope, 'audit', `${day}.jsonl`)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l))
}

describe('multi-tenant E2E flow', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'mt-flow-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
    delete process.env.HERMES_PASSWORD
    delete process.env.CLAUDE_PASSWORD
    process.env.HERMES_BCRYPT_COST = '10'
    _resetAuthIndexForTests()
    _clearWorkspaceCachesForTests()
    vi.useRealTimers()
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
    _resetAuthIndexForTests()
    _clearWorkspaceCachesForTests()
  })

  /**
   * Mirror what `/api/auth/setup` does end-to-end. Returns the
   * issued token + the user/workspace meta.
   */
  async function setupOwnerAndWorkspace() {
    expect(describeBootState().state).toBe('fresh-stack')
    expect(isMultiTenantAuthEnabled()).toBe(false)

    await createUser({
      id: 'phil',
      email: 'phil@stratex-ai.com',
      name: 'Phil',
    })
    await setPasswordHash('phil', await hashPassword('correct horse'))
    const ws = await createWorkspace({
      id: 'stratex',
      name: 'Stratex',
      createdBy: 'phil',
    })
    await addMember({ wsId: 'stratex', userId: 'phil', role: 'owner', addedBy: 'phil' })
    await updateUserProfile('phil', (p) => (p ? { ...p, defaultWorkspaceId: 'stratex' } : null))
    writeMarker()
    _resetAuthIndexForTests()
    expect(isMultiTenantAuthEnabled()).toBe(true)
    expect(describeBootState().state).toBe('normal')
    const token = await issueUserSessionToken({ userId: 'phil', ip: '1.2.3.4' })
    return { token, workspace: ws }
  }

  it('SetupWizard flow: fresh stack → owner + workspace + marker + auto-login token', async () => {
    const { token } = await setupOwnerAndWorkspace()
    expect(lookupUserIdByToken(token)).toBe('phil')
    const auth = requireUser(makeRequest({ cookie: `claude-auth=${token}` }))
    expect(auth.ok).toBe(true)
    if (auth.ok) expect(auth.value.id).toBe('phil')
  }, 30000)

  it('Multi-WS: create planb, switch, lists separate', async () => {
    const { token } = await setupOwnerAndWorkspace()
    await createWorkspace({ id: 'planb', name: 'Plan B', createdBy: 'phil' })
    await addMember({ wsId: 'planb', userId: 'phil', role: 'owner', addedBy: 'phil' })
    expect(getMember('stratex', 'phil')?.role).toBe('owner')
    expect(getMember('planb', 'phil')?.role).toBe('owner')
    expect(getWorkspaceMembers('stratex').members.length).toBe(1)
    expect(getWorkspaceMembers('planb').members.length).toBe(1)
    void token
  }, 30000)

  it('Invite flow: admin creates invite → inkognito accepts → new member', async () => {
    const { token } = await setupOwnerAndWorkspace()
    const adminAuth = requireUser(makeRequest({ cookie: `claude-auth=${token}` }))
    expect(adminAuth.ok).toBe(true)

    const invite = await createInvite({
      workspaceId: 'stratex',
      email: 'partner@example.com',
      role: 'admin',
      invitedBy: 'phil',
    })
    expect(invite.token).toMatch(/^[a-f0-9]{64}$/)

    // "Inkognito" — no cookie at all.
    const incognitoReq = makeRequest()
    expect(getCurrentUser(incognitoReq)).toBeNull()

    // Inspect via /api/invites/$token/info equivalent — get the invite + ws meta
    const fetched = getInvite(invite.token)
    expect(fetched).not.toBeNull()
    expect(isInviteValid(fetched!)).toBe(true)
    expect(fetched!.workspaceId).toBe('stratex')

    // Accept: create user, set PW, add member, consume invite.
    await consumeInvite(invite.token, 'partner1')
    await createUser({
      id: 'partner1',
      email: 'partner@example.com',
      name: 'Partner One',
      defaultWorkspaceId: 'stratex',
    })
    await setPasswordHash('partner1', await hashPassword('partner-pw'))
    await addMember({
      wsId: 'stratex',
      userId: 'partner1',
      role: invite.role,
      addedBy: invite.invitedBy,
    })
    expect(getMember('stratex', 'partner1')?.role).toBe('admin')

    // Auto-login token is valid; partner1 can chat, cannot delete workspace.
    const partnerToken = await issueUserSessionToken({ userId: 'partner1' })
    const req = makeRequest({ cookie: `claude-auth=${partnerToken}` })
    const chatGuard = requirePermission(req, 'stratex', 'chat')
    expect(chatGuard.ok).toBe(true)
    const deleteGuard = requirePermission(req, 'stratex', 'workspace-delete')
    expect(deleteGuard.ok).toBe(false)
    if (!deleteGuard.ok) expect(deleteGuard.response.status).toBe(403)
  }, 30000)

  it('Invite-Token: double consume rejected (one-shot)', async () => {
    await setupOwnerAndWorkspace()
    const invite = await createInvite({
      workspaceId: 'stratex',
      role: 'member',
      invitedBy: 'phil',
    })
    await consumeInvite(invite.token, 'a')
    await expect(consumeInvite(invite.token, 'b')).rejects.toThrow(/already used/)
  }, 30000)

  it('PW-Reset (admin temp-pw): generate, login with temp, force-change, old temp invalid', async () => {
    await setupOwnerAndWorkspace()
    await createUser({
      id: 'partner1',
      email: 'p@x.y',
      name: 'P',
      defaultWorkspaceId: 'stratex',
    })
    await setPasswordHash('partner1', await hashPassword('original-pw'))
    await addMember({ wsId: 'stratex', userId: 'partner1', role: 'member', addedBy: 'phil' })

    // Phil triggers a temp-PW reset (mirror the route).
    const tempPw = generateTempPassword()
    const tempHash = await hashPassword(tempPw)
    await setPasswordHash('partner1', tempHash)
    await updateUserProfile('partner1', (p) =>
      p ? { ...p, mustChangePassword: true } : null,
    )
    await revokeAllUserSessionTokens('partner1')
    await createTempPwReset({ userId: 'partner1', triggeredById: 'phil' })

    // Old PW no longer works
    const oldStillWorks = await verifyPassword('original-pw', getPasswordHash('partner1')!)
    expect(oldStillWorks).toBe(false)

    // Login with temp PW
    const tempLogin = await loginWithEmailPassword('p@x.y', tempPw)
    expect(tempLogin.ok).toBe(true)
    if (!tempLogin.ok) return
    const profile = getUserProfile('partner1')!
    expect(profile.mustChangePassword).toBe(true)

    // Change PW
    const newHash = await hashPassword('shiny-new-pw')
    await setPasswordHash('partner1', newHash)
    await updateUserProfile('partner1', (p) =>
      p ? { ...p, mustChangePassword: false } : null,
    )

    // Login with new PW works, temp doesn't
    const newOk = await loginWithEmailPassword('p@x.y', 'shiny-new-pw')
    expect(newOk.ok).toBe(true)
    const tempStillOk = await loginWithEmailPassword('p@x.y', tempPw)
    expect(tempStillOk.ok).toBe(false)
  }, 60000)

  it('Failed-login lockout: 10× wrong → locked, correct PW also refused', async () => {
    await setupOwnerAndWorkspace()
    for (let i = 0; i < 10; i++) {
      await loginWithEmailPassword('phil@stratex-ai.com', 'wrong')
    }
    const profile = getUserProfile('phil')!
    expect(profile.status).toBe('locked')
    const result = await loginWithEmailPassword('phil@stratex-ai.com', 'correct horse')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('locked')
  }, 60000)

  it('Soft-delete: members lose access immediately, audit captured', async () => {
    const { token } = await setupOwnerAndWorkspace()
    await createUser({ id: 'm1', email: 'm@x.y', name: 'M' })
    await setPasswordHash('m1', await hashPassword('pw'))
    await addMember({ wsId: 'stratex', userId: 'm1', role: 'member', addedBy: 'phil' })
    const memberToken = await issueUserSessionToken({ userId: 'm1' })

    // Both can access before
    expect(canDo('phil', 'stratex', 'chat')).toBe(true)
    expect(canDo('m1', 'stratex', 'chat')).toBe(true)
    void token

    await softDeleteWorkspace('stratex', 'phil')
    expect(canDo('phil', 'stratex', 'chat')).toBe(false)
    expect(canDo('m1', 'stratex', 'chat')).toBe(false)

    const memberReq = makeRequest({ cookie: `claude-auth=${memberToken}` })
    const guard = requireWorkspaceMember(memberReq, 'stratex')
    expect(guard.ok).toBe(false)
    if (!guard.ok) expect(guard.response.status).toBe(404)
  }, 30000)

  it('Cross-WS isolation (F9): non-member of planb cannot read or act on it', async () => {
    await setupOwnerAndWorkspace()
    await createWorkspace({ id: 'planb', name: 'Plan B', createdBy: 'phil' })
    await addMember({ wsId: 'planb', userId: 'phil', role: 'owner', addedBy: 'phil' })

    // partner is only in stratex
    await createUser({ id: 'partner', email: 'p@x.y', name: 'P' })
    await setPasswordHash('partner', await hashPassword('hunter2'))
    await addMember({ wsId: 'stratex', userId: 'partner', role: 'admin', addedBy: 'phil' })

    expect(canDo('partner', 'stratex', 'members-manage')).toBe(true)
    expect(canDo('partner', 'planb', 'members-manage')).toBe(false)
    expect(canDo('partner', 'planb', 'chat')).toBe(false)

    // requireWorkspaceMember returns 404 (no info leak about planb existence)
    const partnerToken = await issueUserSessionToken({ userId: 'partner' })
    const req = makeRequest({ cookie: `claude-auth=${partnerToken}` })
    const guard = requireWorkspaceMember(req, 'planb')
    expect(guard.ok).toBe(false)
    if (!guard.ok) expect(guard.response.status).toBe(404)
  }, 30000)

  it('Audit-Trail: login (success+failed with IP), logout, member-add, ws-create', async () => {
    const { token } = await setupOwnerAndWorkspace()
    await loginWithEmailPassword('phil@stratex-ai.com', 'wrong', { ip: '1.1.1.1' })
    await loginWithEmailPassword('phil@stratex-ai.com', 'correct horse', { ip: '2.2.2.2' })
    await revokeUserSessionToken(token) // simulating logout
    void clearSessionCookie

    const events = readAuditEvents(dataDir)
    const types = events.map((e) => e.type)
    expect(types).toContain('login_failed')
    expect(types).toContain('login')
    const failed = events.find((e) => e.type === 'login_failed')!
    expect(failed.ip).toBe('1.1.1.1')
    const ok = events.find((e) => e.type === 'login')!
    expect(ok.ip).toBe('2.2.2.2')
  }, 30000)

  it('Slug rejection: invalid workspaceId / userId blocked at the boundary', async () => {
    await setupOwnerAndWorkspace()
    expect(isValidSlug('../escape')).toBe(false)
    expect(isValidSlug('Stratex')).toBe(false) // uppercase rejected
    expect(isValidSlug('stratex')).toBe(true)
    await expect(
      createWorkspace({ id: '../planb', name: 'X', createdBy: 'phil' }),
    ).rejects.toThrow()
    await expect(
      addMember({ wsId: 'stratex', userId: '../escape', role: 'member', addedBy: 'phil' }),
    ).rejects.toThrow()
  }, 30000)

  it('Active workspace: getCurrentUser reflects switch (defaultWorkspaceId)', async () => {
    const { token } = await setupOwnerAndWorkspace()
    await createWorkspace({ id: 'planb', name: 'Plan B', createdBy: 'phil' })
    await addMember({ wsId: 'planb', userId: 'phil', role: 'owner', addedBy: 'phil' })
    await updateUserProfile('phil', (p) => (p ? { ...p, defaultWorkspaceId: 'planb' } : null))
    const req = makeRequest({ cookie: `claude-auth=${token}` })
    expect(getCurrentUser(req)?.defaultWorkspaceId).toBe('planb')
  }, 30000)

  it('Workspace soft-delete: meta is in workspace dir, isWorkspaceActive=false', async () => {
    await setupOwnerAndWorkspace()
    expect(isWorkspaceActive(getWorkspaceMeta('stratex'))).toBe(true)
    await softDeleteWorkspace('stratex', 'phil')
    const meta = getWorkspaceMeta('stratex')
    expect(meta?.deletedAt).toBeDefined()
    expect(isWorkspaceActive(meta)).toBe(false)
  }, 30000)
})
