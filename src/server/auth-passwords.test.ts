import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  generateTempPassword,
  getBcryptCost,
  getCostFromHash,
  hashPassword,
  verifyPassword,
} from './auth-passwords'

describe('auth-passwords', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.HERMES_BCRYPT_COST
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('hashPassword + verifyPassword', () => {
    it('hashes and verifies a password (round-trip)', async () => {
      // Use cost=10 in tests — keeps the suite under a second per case.
      process.env.HERMES_BCRYPT_COST = '10'
      const hash = await hashPassword('correct horse battery staple')
      expect(hash).toMatch(/^\$2[aby]\$10\$/)
      expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
      expect(await verifyPassword('wrong password', hash)).toBe(false)
    }, 10000)

    it('produces different hashes for the same password (random salt)', async () => {
      process.env.HERMES_BCRYPT_COST = '10'
      const a = await hashPassword('same')
      const b = await hashPassword('same')
      expect(a).not.toBe(b)
      expect(await verifyPassword('same', a)).toBe(true)
      expect(await verifyPassword('same', b)).toBe(true)
    }, 15000)

    it('rejects empty / non-string passwords', async () => {
      await expect(hashPassword('')).rejects.toThrow(/non-empty string/)
      await expect(hashPassword(undefined as unknown as string)).rejects.toThrow()
    })

    it('verifyPassword returns false on garbage hash without throwing', async () => {
      expect(await verifyPassword('any', 'not-a-bcrypt-hash')).toBe(false)
      expect(await verifyPassword('any', '')).toBe(false)
    })
  })

  describe('getBcryptCost', () => {
    it('defaults to 12', () => {
      expect(getBcryptCost()).toBe(12)
    })

    it('respects HERMES_BCRYPT_COST', () => {
      process.env.HERMES_BCRYPT_COST = '13'
      expect(getBcryptCost()).toBe(13)
    })

    it('clamps below 10 and above 14', () => {
      process.env.HERMES_BCRYPT_COST = '4'
      expect(getBcryptCost()).toBe(10)
      process.env.HERMES_BCRYPT_COST = '20'
      expect(getBcryptCost()).toBe(14)
    })

    it('falls back to default on garbage', () => {
      process.env.HERMES_BCRYPT_COST = 'abc'
      expect(getBcryptCost()).toBe(12)
    })
  })

  describe('getCostFromHash', () => {
    it('extracts cost from a $2b$ hash', async () => {
      process.env.HERMES_BCRYPT_COST = '10'
      const hash = await hashPassword('any')
      expect(getCostFromHash(hash)).toBe(10)
    }, 10000)

    it('returns null on non-bcrypt strings', () => {
      expect(getCostFromHash('not-a-hash')).toBeNull()
      expect(getCostFromHash('')).toBeNull()
    })
  })

  describe('generateTempPassword', () => {
    it('returns 12 chars from the safe alphabet', () => {
      const pw = generateTempPassword()
      expect(pw).toHaveLength(12)
      // No look-alikes
      expect(pw).not.toMatch(/[lI1O0]/)
    })

    it('produces different values across calls', () => {
      const set = new Set<string>()
      for (let i = 0; i < 50; i++) set.add(generateTempPassword())
      expect(set.size).toBeGreaterThan(40) // overwhelmingly unique
    })
  })
})
