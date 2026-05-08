import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  consumeInvite,
  createInvite,
  generateInviteToken,
  getInvite,
  isInviteValid,
  listPendingInvitesForWorkspace,
  revokeInvite,
  sweepExpiredInvites,
} from './invites-store'

describe('invites-store', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'invites-store-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
  })

  describe('createInvite + getInvite', () => {
    it('persists an invite, reads it back', async () => {
      const inv = await createInvite({
        workspaceId: 'stratex',
        email: 'partner@example.com',
        role: 'admin',
        invitedBy: 'phil',
      })
      expect(inv.token).toMatch(/^[a-f0-9]{64}$/)
      expect(inv.workspaceId).toBe('stratex')
      expect(inv.role).toBe('admin')
      expect(inv.used).toBe(false)
      const read = getInvite(inv.token)
      expect(read?.token).toBe(inv.token)
    })

    it('rejects invalid workspaceId', async () => {
      await expect(
        createInvite({ workspaceId: '../evil', role: 'member', invitedBy: 'phil' }),
      ).rejects.toThrow(/invalid workspaceId/)
    })

    it('rejects invalid invitedBy', async () => {
      await expect(
        createInvite({ workspaceId: 'stratex', role: 'member', invitedBy: '../evil' }),
      ).rejects.toThrow(/invalid invitedBy/)
    })

    it('clamps ttlDays to [1, 30]', async () => {
      const a = await createInvite({
        workspaceId: 'stratex', role: 'member', invitedBy: 'phil', ttlDays: 0,
      })
      const b = await createInvite({
        workspaceId: 'stratex', role: 'member', invitedBy: 'phil', ttlDays: 999,
      })
      const oneDay = 24 * 60 * 60 * 1000
      expect(new Date(a.expiresAt).getTime() - new Date(a.createdAt).getTime())
        .toBeGreaterThanOrEqual(oneDay - 1000)
      expect(new Date(b.expiresAt).getTime() - new Date(b.createdAt).getTime())
        .toBeLessThanOrEqual(30 * oneDay + 1000)
    })
  })

  describe('consumeInvite', () => {
    it('flips used + sets usedBy/usedAt', async () => {
      const inv = await createInvite({ workspaceId: 'stratex', role: 'member', invitedBy: 'phil' })
      const after = await consumeInvite(inv.token, 'newuser')
      expect(after.used).toBe(true)
      expect(after.usedBy).toBe('newuser')
      expect(after.usedAt).toBeDefined()
    })

    it('refuses double-consume', async () => {
      const inv = await createInvite({ workspaceId: 'stratex', role: 'member', invitedBy: 'phil' })
      await consumeInvite(inv.token, 'a')
      await expect(consumeInvite(inv.token, 'b')).rejects.toThrow(/already used/)
    })

    it('refuses expired invite', async () => {
      const inv = await createInvite({
        workspaceId: 'stratex', role: 'member', invitedBy: 'phil', ttlDays: 1,
      })
      // Overwrite to make expiry in the past via direct file manipulation
      const fs = await import('node:fs')
      const path = join(dataDir, 'global', 'invites', `${inv.token}.json`)
      const raw = JSON.parse(fs.readFileSync(path, 'utf8'))
      raw.expiresAt = new Date(Date.now() - 1000).toISOString()
      fs.writeFileSync(path, JSON.stringify(raw))
      await expect(consumeInvite(inv.token, 'x')).rejects.toThrow(/expired/)
    })

    it('rejects invalid token format', async () => {
      await expect(consumeInvite('not-a-hex-64', 'phil')).rejects.toThrow(/invalid token format/)
    })
  })

  describe('isInviteValid', () => {
    it('returns false for used invites', async () => {
      const inv = await createInvite({ workspaceId: 'stratex', role: 'member', invitedBy: 'phil' })
      const consumed = await consumeInvite(inv.token, 'newuser')
      expect(isInviteValid(consumed)).toBe(false)
    })

    it('returns true for fresh invites', async () => {
      const inv = await createInvite({ workspaceId: 'stratex', role: 'member', invitedBy: 'phil' })
      expect(isInviteValid(inv)).toBe(true)
    })
  })

  describe('revokeInvite', () => {
    it('deletes a pending invite', async () => {
      const inv = await createInvite({ workspaceId: 'stratex', role: 'member', invitedBy: 'phil' })
      const ok = await revokeInvite(inv.token)
      expect(ok).toBe(true)
      expect(getInvite(inv.token)).toBeNull()
    })

    it('refuses to delete a consumed invite (kept for audit)', async () => {
      const inv = await createInvite({ workspaceId: 'stratex', role: 'member', invitedBy: 'phil' })
      await consumeInvite(inv.token, 'newuser')
      const ok = await revokeInvite(inv.token)
      expect(ok).toBe(false)
      expect(getInvite(inv.token)?.used).toBe(true) // still readable
    })
  })

  describe('listPendingInvitesForWorkspace', () => {
    it('lists only pending, in-workspace, unexpired invites', async () => {
      const a = await createInvite({ workspaceId: 'stratex', role: 'admin', invitedBy: 'phil' })
      await createInvite({ workspaceId: 'stratex', role: 'member', invitedBy: 'phil' })
      const c = await createInvite({ workspaceId: 'planb', role: 'member', invitedBy: 'phil' })
      await consumeInvite(c.token, 'someone')

      const pending = listPendingInvitesForWorkspace('stratex')
      expect(pending.length).toBe(2)
      expect(pending.find((i) => i.token === a.token)).toBeDefined()
    })
  })

  describe('sweepExpiredInvites', () => {
    it('deletes only expired (and not consumed) invites', async () => {
      const fresh = await createInvite({ workspaceId: 'stratex', role: 'member', invitedBy: 'phil' })
      const expired = await createInvite({ workspaceId: 'stratex', role: 'member', invitedBy: 'phil' })
      const consumed = await createInvite({ workspaceId: 'stratex', role: 'member', invitedBy: 'phil' })

      const fs = await import('node:fs')
      const expiredPath = join(dataDir, 'global', 'invites', `${expired.token}.json`)
      const raw = JSON.parse(fs.readFileSync(expiredPath, 'utf8'))
      raw.expiresAt = new Date(Date.now() - 60_000).toISOString()
      fs.writeFileSync(expiredPath, JSON.stringify(raw))

      await consumeInvite(consumed.token, 'someone')

      const deleted = await sweepExpiredInvites()
      expect(deleted).toBe(1)
      expect(getInvite(fresh.token)).not.toBeNull()
      expect(getInvite(expired.token)).toBeNull()
      expect(getInvite(consumed.token)).not.toBeNull() // consumed kept
    })
  })

  describe('generateInviteToken', () => {
    it('produces 64-hex-char tokens, all unique', () => {
      const set = new Set<string>()
      for (let i = 0; i < 50; i++) set.add(generateInviteToken())
      expect(set.size).toBe(50)
      for (const t of set) expect(t).toMatch(/^[a-f0-9]{64}$/)
    })
  })
})
