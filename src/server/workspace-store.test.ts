import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  _clearWorkspaceCachesForTests,
  addMember,
  changeMemberRole,
  createWorkspace,
  getMember,
  getWorkspaceMembers,
  getWorkspaceMeta,
  isWorkspaceActive,
  listWorkspaces,
  removeMember,
  restoreWorkspace,
  softDeleteWorkspace,
  updateWorkspaceMeta,
} from './workspace-store'

describe('workspace-store', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'workspace-store-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
    _clearWorkspaceCachesForTests()
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
    _clearWorkspaceCachesForTests()
  })

  describe('createWorkspace + getWorkspaceMeta', () => {
    it('persists and returns meta', async () => {
      const meta = await createWorkspace({ id: 'stratex', name: 'Stratex', createdBy: 'phil' })
      expect(meta.id).toBe('stratex')
      expect(meta.name).toBe('Stratex')
      expect(meta.createdBy).toBe('phil')
      expect(meta.branding.primaryColor).toMatch(/^#/)
      expect(getWorkspaceMeta('stratex')?.id).toBe('stratex')
    })

    it('rejects duplicate id', async () => {
      await createWorkspace({ id: 'stratex', name: 'Stratex', createdBy: 'phil' })
      await expect(
        createWorkspace({ id: 'stratex', name: 'Other', createdBy: 'phil' }),
      ).rejects.toThrow(/already exists/)
    })

    it('rejects path-traversal in id', async () => {
      await expect(
        createWorkspace({ id: '../planb', name: 'X', createdBy: 'phil' }),
      ).rejects.toThrow()
    })
  })

  describe('Soft-delete + cache invalidation (AK29)', () => {
    it('softDeleteWorkspace sets deletedAt; getWorkspaceMeta sees it on next call', async () => {
      await createWorkspace({ id: 'stratex', name: 'Stratex', createdBy: 'phil' })
      expect(isWorkspaceActive(getWorkspaceMeta('stratex'))).toBe(true)
      await softDeleteWorkspace('stratex', 'phil')
      // Cache is invalidated by the write; next get reflects deletedAt.
      const meta = getWorkspaceMeta('stratex')
      expect(meta?.deletedAt).toBeDefined()
      expect(meta?.deletedBy).toBe('phil')
      expect(isWorkspaceActive(meta)).toBe(false)
    })

    it('restoreWorkspace clears deletedAt', async () => {
      await createWorkspace({ id: 'stratex', name: 'Stratex', createdBy: 'phil' })
      await softDeleteWorkspace('stratex', 'phil')
      await restoreWorkspace('stratex')
      const meta = getWorkspaceMeta('stratex')
      expect(meta?.deletedAt).toBeUndefined()
      expect(isWorkspaceActive(meta)).toBe(true)
    })

    it('listWorkspaces excludes soft-deleted by default, includes with flag', async () => {
      await createWorkspace({ id: 'stratex', name: 'Stratex', createdBy: 'phil' })
      await createWorkspace({ id: 'planb', name: 'Plan B', createdBy: 'phil' })
      await softDeleteWorkspace('planb', 'phil')
      expect(listWorkspaces()).toEqual(['stratex'])
      expect(listWorkspaces({ includeDeleted: true })).toEqual(['planb', 'stratex'])
    })
  })

  describe('mtime cache picks up external writes', () => {
    it('after an updateWorkspaceMeta the next get reflects the change', async () => {
      await createWorkspace({ id: 'stratex', name: 'Stratex', createdBy: 'phil' })
      const before = getWorkspaceMeta('stratex')
      expect(before?.name).toBe('Stratex')
      await updateWorkspaceMeta('stratex', (p) => (p ? { ...p, name: 'Stratex AI' } : null))
      const after = getWorkspaceMeta('stratex')
      expect(after?.name).toBe('Stratex AI')
    })
  })

  describe('Members CRUD', () => {
    beforeEach(async () => {
      await createWorkspace({ id: 'stratex', name: 'Stratex', createdBy: 'phil' })
      // Owner is created explicitly — createWorkspace does not seed members.
      await addMember({ wsId: 'stratex', userId: 'phil', role: 'owner', addedBy: 'phil' })
    })

    it('addMember persists; getMember returns role', async () => {
      await addMember({ wsId: 'stratex', userId: 'partner1', role: 'admin', addedBy: 'phil' })
      const partner = getMember('stratex', 'partner1')
      expect(partner?.role).toBe('admin')
      expect(partner?.addedBy).toBe('phil')
      expect(getWorkspaceMembers('stratex').members).toHaveLength(2)
    })

    it('addMember rejects duplicates', async () => {
      await expect(
        addMember({ wsId: 'stratex', userId: 'phil', role: 'owner', addedBy: 'phil' }),
      ).rejects.toThrow(/already exists/)
    })

    it('removeMember works for non-owner', async () => {
      await addMember({ wsId: 'stratex', userId: 'partner1', role: 'admin', addedBy: 'phil' })
      await removeMember('stratex', 'partner1')
      expect(getMember('stratex', 'partner1')).toBeNull()
    })

    it('removeMember REFUSES the last owner', async () => {
      await expect(removeMember('stratex', 'phil')).rejects.toThrow(/last owner/)
    })

    it('changeMemberRole demote-last-owner is refused', async () => {
      await expect(
        changeMemberRole('stratex', 'phil', 'admin'),
      ).rejects.toThrow(/last owner/)
    })

    it('owner-handover via promote-then-demote works', async () => {
      await addMember({ wsId: 'stratex', userId: 'partner1', role: 'admin', addedBy: 'phil' })
      await changeMemberRole('stratex', 'partner1', 'owner')
      // Now phil can be demoted because there is a second owner.
      await changeMemberRole('stratex', 'phil', 'admin')
      expect(getMember('stratex', 'phil')?.role).toBe('admin')
      expect(getMember('stratex', 'partner1')?.role).toBe('owner')
    })

    it('100 parallel addMember on different users → all 100 land', async () => {
      const tasks = Array.from({ length: 100 }, (_, i) =>
        addMember({ wsId: 'stratex', userId: `m${i}`, role: 'member', addedBy: 'phil' }),
      )
      await Promise.all(tasks)
      const members = getWorkspaceMembers('stratex').members
      // 1 owner + 100 added
      expect(members).toHaveLength(101)
      const ids = new Set(members.map((m) => m.userId))
      for (let i = 0; i < 100; i++) expect(ids.has(`m${i}`)).toBe(true)
    })
  })
})
