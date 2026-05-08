import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('./auth-middleware', () => ({
  isMultiTenantAuthEnabled: vi.fn(),
  isAuthenticated: vi.fn(),
  getCurrentUser: vi.fn(),
}))

import {
  getCurrentUser,
  isAuthenticated,
  isMultiTenantAuthEnabled,
} from './auth-middleware'
import { canSeeErrors, requireStackAdmin } from './error-acl'
import { _clearGlobalSettingsCacheForTests, addStackAdmin } from './global-settings'
import type { UserProfile } from './users-store'

// Helper alias — vi.mocked auto-types based on the input function's signature.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function m<T extends (...args: Array<any>) => any>(fn: T): ReturnType<typeof vi.mocked<T>> {
  return vi.mocked(fn)
}

function mockReq(): Request {
  return new Request('http://test.local/api/errors/list')
}

function makeUser(id: string, status: UserProfile['status'] = 'active'): UserProfile {
  return {
    schemaVersion: 1,
    id,
    email: `${id}@x.test`,
    name: id,
    createdAt: new Date().toISOString(),
    status,
    failedLoginCount: 0,
  }
}

describe('error-acl', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'error-acl-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
    _clearGlobalSettingsCacheForTests()
    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
    _clearGlobalSettingsCacheForTests()
  })

  describe('Fixture A: legacy mode (single-PW)', () => {
    beforeEach(() => {
      m(isMultiTenantAuthEnabled).mockReturnValue(false)
    })

    it('canSeeErrors=true for any authenticated user', () => {
      m(isAuthenticated).mockReturnValue(true)
      expect(canSeeErrors(mockReq())).toBe(true)
    })

    it('canSeeErrors=false when not authenticated', () => {
      m(isAuthenticated).mockReturnValue(false)
      expect(canSeeErrors(mockReq())).toBe(false)
    })

    it('requireStackAdmin returns ok=true with user=null in legacy', () => {
      m(isAuthenticated).mockReturnValue(true)
      const r = requireStackAdmin(mockReq())
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.value.user).toBeNull()
        expect(r.value.mode).toBe('legacy')
      }
    })

    it('requireStackAdmin returns 401 when not authenticated', () => {
      m(isAuthenticated).mockReturnValue(false)
      const r = requireStackAdmin(mockReq())
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.response.status).toBe(401)
    })
  })

  describe('Fixture B: multi-tenant, empty stackAdmins', () => {
    beforeEach(() => {
      m(isMultiTenantAuthEnabled).mockReturnValue(true)
    })

    it('canSeeErrors=false even with active user (no stack-admins yet)', () => {
      m(getCurrentUser).mockReturnValue(makeUser('phil'))
      expect(canSeeErrors(mockReq())).toBe(false)
    })

    it('requireStackAdmin returns 403 reason=not-stack-admin', async () => {
      m(getCurrentUser).mockReturnValue(makeUser('phil'))
      const r = requireStackAdmin(mockReq())
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.response.status).toBe(403)
        const body = (await r.response.json()) as { reason?: string }
        expect(body.reason).toBe('not-stack-admin')
      }
    })

    it('requireStackAdmin returns 401 if no current user', () => {
      m(getCurrentUser).mockReturnValue(null)
      const r = requireStackAdmin(mockReq())
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.response.status).toBe(401)
    })

    it('requireStackAdmin returns 403 reason=user-status:locked for locked user', async () => {
      m(getCurrentUser).mockReturnValue(makeUser('phil', 'locked'))
      const r = requireStackAdmin(mockReq())
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.response.status).toBe(403)
        const body = (await r.response.json()) as { reason?: string }
        expect(body.reason).toBe('user-status:locked')
      }
    })
  })

  describe('Fixture C: multi-tenant, populated stackAdmins', () => {
    beforeEach(async () => {
      m(isMultiTenantAuthEnabled).mockReturnValue(true)
      await addStackAdmin('phil', 'system', 'bootstrap')
    })

    it('canSeeErrors=true for stack-admin user', () => {
      m(getCurrentUser).mockReturnValue(makeUser('phil'))
      expect(canSeeErrors(mockReq())).toBe(true)
    })

    it('canSeeErrors=false for non-admin user', () => {
      m(getCurrentUser).mockReturnValue(makeUser('andre'))
      expect(canSeeErrors(mockReq())).toBe(false)
    })

    it('requireStackAdmin returns ok with mode=multi-tenant', () => {
      m(getCurrentUser).mockReturnValue(makeUser('phil'))
      const r = requireStackAdmin(mockReq())
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.value.user?.id).toBe('phil')
        expect(r.value.mode).toBe('multi-tenant')
      }
    })

    it('requireStackAdmin returns 403 reason=not-stack-admin for non-admin', async () => {
      m(getCurrentUser).mockReturnValue(makeUser('andre'))
      const r = requireStackAdmin(mockReq())
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.response.status).toBe(403)
        const body = (await r.response.json()) as { reason?: string }
        expect(body.reason).toBe('not-stack-admin')
      }
    })
  })
})
