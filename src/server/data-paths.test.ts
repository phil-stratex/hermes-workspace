import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  getDataDir,
  getGlobalDir,
  getTrashDir,
  getUserDir,
  getWorkspaceDir,
  isValidSlug,
} from './data-paths'

describe('data-paths', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.HERMES_DATA_DIR
    delete process.env.HERMES_HOME
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('getDataDir', () => {
    it('respects HERMES_DATA_DIR over HERMES_HOME', () => {
      process.env.HERMES_DATA_DIR = '/explicit/data'
      process.env.HERMES_HOME = '/should/not/win'
      expect(getDataDir()).toBe('/explicit/data')
    })

    it('falls back to HERMES_HOME when HERMES_DATA_DIR is unset', () => {
      process.env.HERMES_HOME = '/opt/data'
      expect(getDataDir()).toBe('/opt/data')
    })

    it('falls back to ~/.hermes when both env vars are unset', () => {
      expect(getDataDir()).toBe(join(homedir(), '.hermes'))
    })

    it('treats empty env values as unset', () => {
      process.env.HERMES_DATA_DIR = ''
      process.env.HERMES_HOME = '/opt/data'
      expect(getDataDir()).toBe('/opt/data')
    })
  })

  describe('getWorkspaceDir / getUserDir', () => {
    beforeEach(() => {
      process.env.HERMES_DATA_DIR = '/d'
    })

    it('joins under workspaces/<id>', () => {
      expect(getWorkspaceDir('stratex')).toBe(join('/d', 'workspaces', 'stratex'))
    })

    it('joins under users/<id>', () => {
      expect(getUserDir('phil')).toBe(join('/d', 'users', 'phil'))
    })

    it('rejects path-traversal attempts', () => {
      expect(() => getWorkspaceDir('..')).toThrow(/invalid workspaceId/)
      expect(() => getWorkspaceDir('../planb')).toThrow(/invalid workspaceId/)
      expect(() => getWorkspaceDir('a/b')).toThrow(/invalid workspaceId/)
      expect(() => getUserDir('..')).toThrow(/invalid userId/)
    })

    it('rejects shell metacharacters and uppercase', () => {
      expect(() => getWorkspaceDir('Stratex')).toThrow()
      expect(() => getWorkspaceDir('a$b')).toThrow()
      expect(() => getWorkspaceDir('-leading')).toThrow()
      expect(() => getWorkspaceDir('trailing-')).toThrow()
      expect(() => getWorkspaceDir('')).toThrow()
    })

    it('accepts canonical slugs', () => {
      expect(isValidSlug('stratex')).toBe(true)
      expect(isValidSlug('plan-b')).toBe(true)
      expect(isValidSlug('w1')).toBe(true)
      expect(isValidSlug('a')).toBe(true)
    })
  })

  describe('getGlobalDir / getTrashDir', () => {
    it('global = data/global', () => {
      process.env.HERMES_DATA_DIR = '/d'
      expect(getGlobalDir()).toBe(join('/d', 'global'))
    })

    it('trash = global/trash', () => {
      process.env.HERMES_DATA_DIR = '/d'
      expect(getTrashDir()).toBe(join('/d', 'global', 'trash'))
    })
  })
})
