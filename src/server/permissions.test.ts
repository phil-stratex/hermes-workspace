import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { canDo, getRoleForUser, listActionsForUser } from './permissions'
import {
  _clearWorkspaceCachesForTests,
  addMember,
  createWorkspace,
  softDeleteWorkspace,
} from './workspace-store'
import type { Action } from './permissions'
import type { WorkspaceRole } from './workspace-store'

describe('permissions', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'permissions-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
    _clearWorkspaceCachesForTests()
    await createWorkspace({ id: 'stratex', name: 'Stratex', createdBy: 'phil' })
    await addMember({ wsId: 'stratex', userId: 'phil', role: 'owner', addedBy: 'phil' })
    await addMember({ wsId: 'stratex', userId: 'admin1', role: 'admin', addedBy: 'phil' })
    await addMember({ wsId: 'stratex', userId: 'member1', role: 'member', addedBy: 'phil' })
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
    _clearWorkspaceCachesForTests()
  })

  describe('Truth-Table — A.3 from spec', () => {
    type Case = { action: Action; allow: ReadonlyArray<WorkspaceRole> }
    const cases: ReadonlyArray<Case> = [
      { action: 'chat',                allow: ['owner', 'admin', 'member'] },
      { action: 'memory-read',         allow: ['owner', 'admin', 'member'] },
      { action: 'memory-write',        allow: ['owner', 'admin', 'member'] },
      { action: 'memory-hard-delete',  allow: ['owner', 'admin'] },
      { action: 'skills-read',         allow: ['owner', 'admin', 'member'] },
      { action: 'skills-edit',         allow: ['owner', 'admin'] },
      { action: 'roster-edit',         allow: ['owner', 'admin'] },
      { action: 'worker-control',      allow: ['owner', 'admin', 'member'] },
      { action: 'session-share',       allow: ['owner', 'admin', 'member'] },
      { action: 'workspace-settings',  allow: ['owner', 'admin'] },
      { action: 'members-manage',      allow: ['owner', 'admin'] },
      { action: 'federation-manage',   allow: ['owner', 'admin'] },
      { action: 'audit-view',          allow: ['owner', 'admin'] },
      { action: 'user-pw-reset',       allow: ['owner', 'admin'] },
      { action: 'workspace-delete',    allow: ['owner'] },
      { action: 'owner-handover',      allow: ['owner'] },
      { action: 'view-usage',          allow: ['owner', 'admin', 'member'] },
    ]
    const userByRole: Record<WorkspaceRole, string> = {
      owner: 'phil',
      admin: 'admin1',
      member: 'member1',
    }
    const roles: ReadonlyArray<WorkspaceRole> = ['owner', 'admin', 'member']

    for (const { action, allow } of cases) {
      for (const role of roles) {
        const userId = userByRole[role]
        const expected = allow.includes(role)
        it(`${role} ${expected ? 'CAN' : 'CANNOT'} ${action}`, () => {
          expect(canDo(userId, 'stratex', action)).toBe(expected)
        })
      }
    }
  })

  describe('Cross-workspace isolation (F9)', () => {
    it('non-member cannot do anything in a workspace they do not belong to', async () => {
      await createWorkspace({ id: 'planb', name: 'Plan B', createdBy: 'phil' })
      await addMember({ wsId: 'planb', userId: 'phil', role: 'owner', addedBy: 'phil' })
      // admin1 is a member of stratex but NOT planb.
      expect(canDo('admin1', 'planb', 'chat')).toBe(false)
      expect(canDo('admin1', 'planb', 'members-manage')).toBe(false)
      expect(canDo('admin1', 'planb', 'audit-view')).toBe(false)
      // No actions list for non-members.
      expect(listActionsForUser('admin1', 'planb')).toEqual([])
    })

    it('returns false for entirely non-existent users', () => {
      expect(canDo('ghost', 'stratex', 'chat')).toBe(false)
      expect(getRoleForUser('ghost', 'stratex')).toBeNull()
    })

    it('returns false for non-existent workspace', () => {
      expect(canDo('phil', 'nope', 'chat')).toBe(false)
    })
  })

  describe('Soft-deleted workspace denies everything', () => {
    it('owner of a soft-deleted workspace cannot perform any action', async () => {
      await softDeleteWorkspace('stratex', 'phil')
      expect(canDo('phil', 'stratex', 'chat')).toBe(false)
      expect(canDo('phil', 'stratex', 'workspace-settings')).toBe(false)
      expect(canDo('phil', 'stratex', 'workspace-delete')).toBe(false)
      expect(listActionsForUser('phil', 'stratex')).toEqual([])
    })
  })

  describe('listActionsForUser', () => {
    it('owner has all actions', () => {
      const actions = listActionsForUser('phil', 'stratex')
      expect(actions).toContain('workspace-delete')
      expect(actions).toContain('owner-handover')
      expect(actions).toContain('chat')
    })

    it('member only has the member-allowed actions', () => {
      const actions = listActionsForUser('member1', 'stratex')
      expect(actions).toContain('chat')
      expect(actions).toContain('worker-control')
      expect(actions).toContain('session-share')
      expect(actions).not.toContain('workspace-delete')
      expect(actions).not.toContain('roster-edit')
      expect(actions).not.toContain('audit-view')
    })
  })
})
