import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  _resetAuthIndexForTests,
  issueUserSessionToken,
} from './auth-middleware'
import { hashPassword } from './auth-passwords'
import { writeMarker } from './migration-marker'
import { createUser, setPasswordHash, updateUserProfile } from './users-store'
import {
  _clearWorkspaceCachesForTests,
  addMember,
  createWorkspace,
  softDeleteWorkspace,
} from './workspace-store'
import {
  requireActiveWorkspaceMember,
  requireAuthenticated,
  requireWorkspaceAction,
} from './route-auth-helpers'

function makeReq(opts: { cookie?: string } = {}): Request {
  const headers: Record<string, string> = {}
  if (opts.cookie) headers.cookie = opts.cookie
  return new Request('http://test/x', { method: 'GET', headers })
}

describe('route-auth-helpers', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'route-auth-helpers-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
    delete process.env.HERMES_PASSWORD
    delete process.env.CLAUDE_PASSWORD
    process.env.HERMES_BCRYPT_COST = '10'
    _resetAuthIndexForTests()
    _clearWorkspaceCachesForTests()
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
    _resetAuthIndexForTests()
    _clearWorkspaceCachesForTests()
  })

  describe('legacy mode (pre-migration)', () => {
    it('requireAuthenticated with HERMES_PASSWORD unset → 401 even unprotected', () => {
      // No password configured AND no marker → isAuthenticated returns true
      // for any request (legacy "auth not required" mode).
      const r = requireAuthenticated(makeReq())
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.value.multiTenant).toBe(false)
        expect(r.value.user).toBeNull()
        expect(r.value.wsId).toBeNull()
      }
    })

    it('requireAuthenticated with HERMES_PASSWORD set + no cookie → 401', () => {
      process.env.HERMES_PASSWORD = 'sekret'
      const r = requireAuthenticated(makeReq())
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.response.status).toBe(401)
    })

    it('requireWorkspaceAction degrades to auth-only check in legacy mode', () => {
      // No marker → multi-tenant disabled. Even with a "real" action,
      // it just runs the auth check.
      process.env.HERMES_PASSWORD = 'sekret'
      const r = requireWorkspaceAction(makeReq(), 'workspace-delete')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.response.status).toBe(401)
    })
  })

  describe('multi-tenant mode (post-migration)', () => {
    beforeEach(async () => {
      writeMarker()
      _resetAuthIndexForTests()
      await createUser({ id: 'phil', email: 'phil@x.y', name: 'Phil' })
      await setPasswordHash('phil', await hashPassword('s'))
      await createWorkspace({ id: 'stratex', name: 'Stratex', createdBy: 'phil' })
      await addMember({ wsId: 'stratex', userId: 'phil', role: 'owner', addedBy: 'phil' })
      await updateUserProfile('phil', (p) =>
        p ? { ...p, defaultWorkspaceId: 'stratex' } : null,
      )
    })

    it('requireAuthenticated returns user + active wsId', async () => {
      const token = await issueUserSessionToken({ userId: 'phil' })
      const r = requireAuthenticated(makeReq({ cookie: `claude-auth=${token}` }))
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.value.multiTenant).toBe(true)
        expect(r.value.user?.id).toBe('phil')
        expect(r.value.wsId).toBe('stratex')
      }
    })

    it('requireAuthenticated returns 401 without cookie', () => {
      const r = requireAuthenticated(makeReq())
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.response.status).toBe(401)
    })

    it('requireWorkspaceAction passes for owner with allowed action', async () => {
      const token = await issueUserSessionToken({ userId: 'phil' })
      const r = requireWorkspaceAction(makeReq({ cookie: `claude-auth=${token}` }), 'workspace-delete')
      expect(r.ok).toBe(true)
    })

    it('requireWorkspaceAction returns 403 for member without action', async () => {
      await createUser({ id: 'm1', email: 'm1@x.y', name: 'M' })
      await setPasswordHash('m1', await hashPassword('s'))
      await addMember({ wsId: 'stratex', userId: 'm1', role: 'member', addedBy: 'phil' })
      await updateUserProfile('m1', (p) =>
        p ? { ...p, defaultWorkspaceId: 'stratex' } : null,
      )
      const token = await issueUserSessionToken({ userId: 'm1' })
      const r = requireWorkspaceAction(
        makeReq({ cookie: `claude-auth=${token}` }),
        'workspace-delete',
      )
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.response.status).toBe(403)
    }, 10000)

    it('requireWorkspaceAction returns 409 when caller has no active workspace', async () => {
      await createUser({ id: 'orphan', email: 'o@x.y', name: 'O' })
      await setPasswordHash('orphan', await hashPassword('s'))
      // Note: no defaultWorkspaceId, no membership.
      const token = await issueUserSessionToken({ userId: 'orphan' })
      const r = requireWorkspaceAction(
        makeReq({ cookie: `claude-auth=${token}` }),
        'chat',
      )
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.response.status).toBe(409)
    }, 10000)

    it('requireActiveWorkspaceMember passes for any member without checking action', async () => {
      await createUser({ id: 'm1', email: 'm1@x.y', name: 'M' })
      await setPasswordHash('m1', await hashPassword('s'))
      await addMember({ wsId: 'stratex', userId: 'm1', role: 'member', addedBy: 'phil' })
      await updateUserProfile('m1', (p) =>
        p ? { ...p, defaultWorkspaceId: 'stratex' } : null,
      )
      const token = await issueUserSessionToken({ userId: 'm1' })
      const r = requireActiveWorkspaceMember(makeReq({ cookie: `claude-auth=${token}` }))
      expect(r.ok).toBe(true)
    }, 10000)

    it('requireActiveWorkspaceMember returns 404 for soft-deleted workspace', async () => {
      await softDeleteWorkspace('stratex', 'phil')
      const token = await issueUserSessionToken({ userId: 'phil' })
      const r = requireActiveWorkspaceMember(makeReq({ cookie: `claude-auth=${token}` }))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.response.status).toBe(404)
    })
  })
})
