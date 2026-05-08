import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  _clearGlobalSettingsCacheForTests,
  addStackAdmin,
  getErrorRetentionDays,
  getStackAdmins,
  isStackAdmin,
  removeStackAdmin,
  setBrandingColor,
  setErrorRetentionDays,
} from './global-settings'

describe('global-settings', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'global-settings-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
    _clearGlobalSettingsCacheForTests()
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
    _clearGlobalSettingsCacheForTests()
  })

  describe('default state', () => {
    it('returns empty stackAdmins when no settings file exists', () => {
      expect(getStackAdmins()).toEqual([])
      expect(isStackAdmin('phil')).toBe(false)
    })
    it('returns default retention 30 days', () => {
      expect(getErrorRetentionDays()).toBe(30)
    })
  })

  describe('addStackAdmin', () => {
    it('persists a new entry', async () => {
      const result = await addStackAdmin('phil', 'system', 'bootstrap')
      expect(result.added).toBe(true)
      expect(result.entry.userId).toBe('phil')
      expect(result.entry.addedVia).toBe('bootstrap')
      expect(getStackAdmins()).toHaveLength(1)
      expect(isStackAdmin('phil')).toBe(true)
    })
    it('is idempotent — second add returns added=false', async () => {
      await addStackAdmin('phil', 'system', 'bootstrap')
      const second = await addStackAdmin('phil', 'system', 'cli')
      expect(second.added).toBe(false)
      expect(getStackAdmins()).toHaveLength(1)
    })
    it('rejects invalid userId slug', async () => {
      await expect(addStackAdmin('../escape', 'me', 'cli')).rejects.toThrow(/invalid userId/)
    })
    it('writes audit-event in the global audit channel', async () => {
      await addStackAdmin('phil', 'system', 'cli')
      const today = new Date().toISOString().slice(0, 10)
      const file = join(dataDir, 'global', 'audit', `${today}.jsonl`)
      expect(existsSync(file)).toBe(true)
      const lines = readFileSync(file, 'utf8').trim().split('\n')
      const event = JSON.parse(lines[0])
      expect(event.type).toBe('stack_admin_added')
      expect(event.target).toBe('phil')
      expect(event.addedVia).toBe('cli')
    })
  })

  describe('removeStackAdmin', () => {
    it('removes when more than one admin exists', async () => {
      await addStackAdmin('phil', 'system', 'cli')
      await addStackAdmin('andre', 'phil', 'cli')
      const r = await removeStackAdmin('andre', 'phil', 'cli')
      expect(r.removed).toBe(true)
      expect(getStackAdmins()).toHaveLength(1)
      expect(isStackAdmin('andre')).toBe(false)
    })
    it('refuses to remove the last admin (Lockout-Schutz)', async () => {
      await addStackAdmin('phil', 'system', 'cli')
      await expect(removeStackAdmin('phil', 'phil', 'cli')).rejects.toThrow(
        /refuse to remove the last stack-admin/,
      )
      expect(isStackAdmin('phil')).toBe(true)
    })
    it('returns removed=false for unknown user', async () => {
      await addStackAdmin('phil', 'system', 'cli')
      const r = await removeStackAdmin('nobody', 'phil', 'cli')
      expect(r.removed).toBe(false)
    })
  })

  describe('parallel writes', () => {
    it('50 parallel addStackAdmin (different userIds) → all 50 persisted', async () => {
      const ids = Array.from({ length: 50 }, (_, i) => `user-${i}`)
      await Promise.all(ids.map((id) => addStackAdmin(id, 'system', 'cli')))
      const list = getStackAdmins()
      expect(list).toHaveLength(50)
      const set = new Set(list.map((e) => e.userId))
      expect(set.size).toBe(50)
    })
    it('parallel addStackAdmin + setBrandingColor — both persisted, file valid', async () => {
      await Promise.all([
        addStackAdmin('phil', 'system', 'cli'),
        setBrandingColor('#ff0000', 'phil'),
      ])
      _clearGlobalSettingsCacheForTests()
      const list = getStackAdmins()
      expect(list).toHaveLength(1)
      // re-read raw JSON to catch any torn write
      const path = join(dataDir, 'global', 'settings.json')
      expect(() => JSON.parse(readFileSync(path, 'utf8'))).not.toThrow()
    })
  })

  describe('retention', () => {
    it('persists retention days', async () => {
      await setErrorRetentionDays(60, 'phil')
      expect(getErrorRetentionDays()).toBe(60)
    })
    it('rejects invalid retention', async () => {
      await expect(setErrorRetentionDays(0, 'phil')).rejects.toThrow(/invalid retentionDays/)
      await expect(setErrorRetentionDays(99999, 'phil')).rejects.toThrow(/invalid retentionDays/)
    })
  })

  describe('schema-version mismatch', () => {
    it('throws on read of unknown schemaVersion', () => {
      const path = join(dataDir, 'global', 'settings.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify({ schemaVersion: 99, stackAdmins: [] }))
      _clearGlobalSettingsCacheForTests()
      expect(() => getStackAdmins()).toThrow(/version mismatch/)
    })
  })

  describe('isStackAdmin defensive', () => {
    it('returns false for null/undefined/empty userId', () => {
      expect(isStackAdmin(null)).toBe(false)
      expect(isStackAdmin(undefined)).toBe(false)
      expect(isStackAdmin('')).toBe(false)
    })
    it('returns false for invalid slug (path-traversal attempt)', () => {
      expect(isStackAdmin('../escape')).toBe(false)
    })
  })
})
