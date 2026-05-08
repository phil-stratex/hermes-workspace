import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  FAILED_LOGIN_THRESHOLD,
  createUser,
  getPasswordHash,
  getUserProfile,
  isUserLocked,
  listUsers,
  recordFailedLogin,
  recordSuccessfulLogin,
  setPasswordHash,
  updateUserProfile,
} from './users-store'

describe('users-store', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'users-store-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
  })

  describe('createUser', () => {
    it('persists profile and lists user', async () => {
      await createUser({ id: 'phil', email: 'phil@stratex-ai.com', name: 'Phil' })
      const profile = getUserProfile('phil')
      expect(profile?.id).toBe('phil')
      expect(profile?.email).toBe('phil@stratex-ai.com')
      expect(profile?.name).toBe('Phil')
      expect(profile?.failedLoginCount).toBe(0)
      expect(profile?.status).toBe('active')
      expect(listUsers()).toEqual(['phil'])
    })

    it('rejects duplicate id', async () => {
      await createUser({ id: 'phil', email: 'a@b.c', name: 'Phil' })
      await expect(
        createUser({ id: 'phil', email: 'x@y.z', name: 'Phil2' }),
      ).rejects.toThrow(/already exists/)
    })

    it('rejects invalid id (path-traversal attempt)', async () => {
      await expect(
        createUser({ id: '..', email: 'a@b.c', name: 'X' }),
      ).rejects.toThrow(/invalid userId/)
    })
  })

  describe('updateUserProfile', () => {
    it('applies a patch under mutex', async () => {
      await createUser({ id: 'phil', email: 'a@b.c', name: 'Phil' })
      const updated = await updateUserProfile('phil', (p) =>
        p ? { ...p, name: 'Phil Stratex' } : null,
      )
      expect(updated?.name).toBe('Phil Stratex')
      expect(getUserProfile('phil')?.name).toBe('Phil Stratex')
    })

    it('rejects patch that changes id', async () => {
      await createUser({ id: 'phil', email: 'a@b.c', name: 'Phil' })
      await expect(
        updateUserProfile('phil', (p) => (p ? { ...p, id: 'other' } : null)),
      ).rejects.toThrow(/must not change userId/)
    })

    it('returns null for missing user', async () => {
      const result = await updateUserProfile('ghost', (p) => p ?? null)
      expect(result).toBeNull()
    })
  })

  describe('Failed-login lockout (F6 race-test)', () => {
    it('50 parallel recordFailedLogin → counter exactly 50, no lost increments', async () => {
      await createUser({ id: 'phil', email: 'a@b.c', name: 'Phil' })
      // Reset threshold side-effect: we don't care about lock here, only the counter.
      const N = 50
      const tasks = Array.from({ length: N }, () => recordFailedLogin('phil'))
      await Promise.all(tasks)
      const profile = getUserProfile('phil')
      // 50 increments must produce exactly 50 — a read-modify-write race
      // would lose some.
      expect(profile?.failedLoginCount).toBe(N)
    })

    it('crosses the threshold → status locked + lockedUntil set', async () => {
      await createUser({ id: 'phil', email: 'a@b.c', name: 'Phil' })
      for (let i = 0; i < FAILED_LOGIN_THRESHOLD; i++) {
        await recordFailedLogin('phil')
      }
      const profile = getUserProfile('phil')
      expect(profile?.status).toBe('locked')
      expect(profile?.lockedUntil).toBeDefined()
      expect(isUserLocked(profile!)).toBe(true)
    })

    it('successful login clears the counter and unlocks', async () => {
      await createUser({ id: 'phil', email: 'a@b.c', name: 'Phil' })
      for (let i = 0; i < FAILED_LOGIN_THRESHOLD; i++) {
        await recordFailedLogin('phil')
      }
      const after = await recordSuccessfulLogin('phil')
      expect(after?.failedLoginCount).toBe(0)
      expect(after?.status).toBe('active')
      expect(after?.lockedUntil).toBeUndefined()
      expect(after?.lastLoginAt).toBeDefined()
    })

    it('isUserLocked is false after lockedUntil expires', async () => {
      await createUser({ id: 'phil', email: 'a@b.c', name: 'Phil' })
      const inThePast = new Date(Date.now() - 60 * 1000).toISOString()
      await updateUserProfile('phil', (p) =>
        p ? { ...p, status: 'locked', lockedUntil: inThePast } : null,
      )
      const profile = getUserProfile('phil')!
      expect(isUserLocked(profile)).toBe(false)
    })
  })

  describe('password hash persistence', () => {
    it('writes and reads back the hash', async () => {
      await createUser({ id: 'phil', email: 'a@b.c', name: 'Phil' })
      await setPasswordHash('phil', '$2b$10$some-hash-string')
      expect(getPasswordHash('phil')).toBe('$2b$10$some-hash-string')
    })

    it('returns null for a missing hash', async () => {
      await createUser({ id: 'phil', email: 'a@b.c', name: 'Phil' })
      expect(getPasswordHash('phil')).toBeNull()
    })

    it('rejects invalid userId', async () => {
      await expect(setPasswordHash('../evil', 'x')).rejects.toThrow(/invalid userId/)
    })
  })
})
