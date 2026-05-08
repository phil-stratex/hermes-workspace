import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  consumePwReset,
  createResetLink,
  createTempPwReset,
  getPwReset,
  isPwResetValid,
  revokePwReset,
} from './pw-resets-store'

describe('pw-resets-store', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'pw-resets-store-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
  })

  describe('createTempPwReset', () => {
    it('writes a reset record with type=temp-password and 24h TTL', async () => {
      const r = await createTempPwReset({ userId: 'phil', triggeredById: 'admin1' })
      expect(r.type).toBe('temp-password')
      expect(r.userId).toBe('phil')
      expect(r.triggeredBy).toBe('admin')
      expect(r.triggeredById).toBe('admin1')
      expect(r.used).toBe(false)
      const ttl = new Date(r.expiresAt).getTime() - new Date(r.createdAt).getTime()
      expect(ttl).toBeGreaterThan(23 * 3600 * 1000)
      expect(ttl).toBeLessThan(25 * 3600 * 1000)
    })

    it('rejects invalid userId', async () => {
      await expect(
        createTempPwReset({ userId: '../evil', triggeredById: 'admin1' }),
      ).rejects.toThrow(/invalid userId/)
    })

    it('rejects invalid triggeredById', async () => {
      await expect(
        createTempPwReset({ userId: 'phil', triggeredById: '../evil' }),
      ).rejects.toThrow(/invalid triggeredById/)
    })
  })

  describe('createResetLink', () => {
    it('writes a reset record with type=reset-link and 1h TTL', async () => {
      const r = await createResetLink({ userId: 'phil' })
      expect(r.type).toBe('reset-link')
      expect(r.triggeredBy).toBe('self')
      const ttl = new Date(r.expiresAt).getTime() - new Date(r.createdAt).getTime()
      expect(ttl).toBeGreaterThan(50 * 60 * 1000)
      expect(ttl).toBeLessThan(70 * 60 * 1000)
    })
  })

  describe('consumePwReset', () => {
    it('flips used + sets usedAt', async () => {
      const r = await createTempPwReset({ userId: 'phil', triggeredById: 'admin1' })
      const after = await consumePwReset(r.token)
      expect(after.used).toBe(true)
      expect(after.usedAt).toBeDefined()
    })

    it('refuses double-consume', async () => {
      const r = await createTempPwReset({ userId: 'phil', triggeredById: 'admin1' })
      await consumePwReset(r.token)
      await expect(consumePwReset(r.token)).rejects.toThrow(/already used/)
    })

    it('refuses expired reset', async () => {
      const r = await createTempPwReset({ userId: 'phil', triggeredById: 'admin1' })
      const fs = await import('node:fs')
      const path = join(dataDir, 'global', 'pw-resets', `${r.token}.json`)
      const raw = JSON.parse(fs.readFileSync(path, 'utf8'))
      raw.expiresAt = new Date(Date.now() - 1000).toISOString()
      fs.writeFileSync(path, JSON.stringify(raw))
      await expect(consumePwReset(r.token)).rejects.toThrow(/expired/)
    })
  })

  describe('isPwResetValid', () => {
    it('false for used', async () => {
      const r = await createTempPwReset({ userId: 'phil', triggeredById: 'admin1' })
      const consumed = await consumePwReset(r.token)
      expect(isPwResetValid(consumed)).toBe(false)
    })

    it('true for fresh', async () => {
      const r = await createTempPwReset({ userId: 'phil', triggeredById: 'admin1' })
      expect(isPwResetValid(r)).toBe(true)
    })
  })

  describe('revokePwReset', () => {
    it('deletes a pending reset', async () => {
      const r = await createTempPwReset({ userId: 'phil', triggeredById: 'admin1' })
      const ok = await revokePwReset(r.token)
      expect(ok).toBe(true)
      expect(getPwReset(r.token)).toBeNull()
    })

    it('rejects malformed token', async () => {
      await expect(revokePwReset('not-hex')).rejects.toThrow(/invalid token format/)
    })
  })
})
