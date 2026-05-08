import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  filterVisibleSessions,
  listSessionsOwnedBy,
  readSessionsMeta,
  shareSession,
  tagSession,
  transferSessionsOwnership,
  unshareSession,
  updateSessionsMeta,
} from './sessions-privacy'
import type { FilteredSessions } from './sessions-types'

describe('sessions-privacy', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sessions-privacy-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
  })

  describe('readSessionsMeta', () => {
    it('returns empty meta for a fresh workspace', () => {
      const meta = readSessionsMeta('stratex')
      expect(meta.schemaVersion).toBe(1)
      expect(meta.sessions).toEqual({})
    })

    it('rejects invalid wsId (path-traversal)', () => {
      expect(() => readSessionsMeta('../escape')).toThrow(/invalid wsId/)
    })
  })

  describe('tagSession', () => {
    it('writes the entry on first call, no-op on second', async () => {
      await tagSession('stratex', 's1', 'phil')
      let meta = readSessionsMeta('stratex')
      expect(meta.sessions.s1.ownerId).toBe('phil')
      expect(meta.sessions.s1.shared).toBe(false)
      expect(meta.sessions.s1.createdAt).toBeDefined()

      const beforeTs = meta.sessions.s1.createdAt
      await tagSession('stratex', 's1', 'someone-else')
      meta = readSessionsMeta('stratex')
      expect(meta.sessions.s1.ownerId).toBe('phil')
      expect(meta.sessions.s1.createdAt).toBe(beforeTs)
    })
  })

  describe('filterVisibleSessions (L6 brand)', () => {
    beforeEach(async () => {
      await tagSession('stratex', 's1', 'phil')
      await tagSession('stratex', 's2', 'partner')
      await tagSession('stratex', 's3', 'phil')
      await shareSession({ wsId: 'stratex', sessionId: 's3', sharedBy: 'phil' })
    })

    it('returns only own + shared sessions for the user', () => {
      const meta = readSessionsMeta('stratex')
      const all = [{ key: 's1' }, { key: 's2' }, { key: 's3' }]
      // Phil sees s1 (own) + s3 (own + shared)
      const philVisible = filterVisibleSessions(all, 'phil', meta)
      expect(philVisible.map((s) => s.key)).toEqual(['s1', 's3'])
      // Partner sees s2 (own) + s3 (shared)
      const partnerVisible = filterVisibleSessions(all, 'partner', meta)
      expect(partnerVisible.map((s) => s.key)).toEqual(['s2', 's3'])
      // Stranger sees only s3 (shared)
      const strangerVisible = filterVisibleSessions(all, 'stranger', meta)
      expect(strangerVisible.map((s) => s.key)).toEqual(['s3'])
    })

    it('fail-closed for untagged sessions', () => {
      const meta = readSessionsMeta('stratex')
      const all = [{ key: 's1' }, { key: 's999-unknown' }]
      const visible = filterVisibleSessions(all, 'phil', meta)
      expect(visible.map((s) => s.key)).toEqual(['s1'])
    })

    it('fall-through to id / friendlyId when key is absent', () => {
      const meta = readSessionsMeta('stratex')
      const all = [
        { id: 's1' },
        { friendlyId: 's3' },
        { id: 'never-tagged' },
      ]
      const visible = filterVisibleSessions(all, 'phil', meta)
      expect(visible).toHaveLength(2)
    })

    it('returns the unfiltered list for the audit-view sentinel "*"', () => {
      const meta = readSessionsMeta('stratex')
      const all = [{ key: 's1' }, { key: 's2' }, { key: 's3' }]
      const audit = filterVisibleSessions(all, '*', meta)
      expect(audit).toHaveLength(3)
    })

    it('preserves brand on output (compile-time check via assignment)', () => {
      const meta = readSessionsMeta('stratex')
      const all = [{ key: 's1' }]
      const filtered: FilteredSessions<{ key: string }> = filterVisibleSessions(all, 'phil', meta)
      expect(Array.isArray(filtered)).toBe(true)
    })
  })

  describe('shareSession / unshareSession', () => {
    it('refuses to share an untagged session', async () => {
      await expect(
        shareSession({ wsId: 'stratex', sessionId: 'unknown', sharedBy: 'phil' }),
      ).rejects.toThrow(/cannot share untagged/)
    })

    it('flips shared, sharedAt, sharedBy', async () => {
      await tagSession('stratex', 's1', 'phil')
      const after = await shareSession({ wsId: 'stratex', sessionId: 's1', sharedBy: 'phil' })
      expect(after.shared).toBe(true)
      expect(after.sharedBy).toBe('phil')
      expect(after.sharedAt).toBeDefined()
    })

    it('un-share clears shared + share-only fields', async () => {
      await tagSession('stratex', 's1', 'phil')
      await shareSession({ wsId: 'stratex', sessionId: 's1', sharedBy: 'phil' })
      const after = await unshareSession({ wsId: 'stratex', sessionId: 's1' })
      expect(after.shared).toBe(false)
      expect(after.sharedAt).toBeUndefined()
      expect(after.sharedBy).toBeUndefined()
    })

    it('un-share refuses unknown session', async () => {
      await expect(
        unshareSession({ wsId: 'stratex', sessionId: 'ghost' }),
      ).rejects.toThrow(/session not found/)
    })
  })

  describe('transferSessionsOwnership', () => {
    it('moves all sessions from one user to another, returns count', async () => {
      await tagSession('stratex', 's1', 'phil')
      await tagSession('stratex', 's2', 'phil')
      await tagSession('stratex', 's3', 'partner')
      const moved = await transferSessionsOwnership({
        wsId: 'stratex',
        fromUserId: 'phil',
        toUserId: 'admin1',
      })
      expect(moved).toBe(2)
      expect(listSessionsOwnedBy('stratex', 'phil')).toEqual([])
      expect(listSessionsOwnedBy('stratex', 'admin1').sort()).toEqual(['s1', 's2'])
      expect(listSessionsOwnedBy('stratex', 'partner')).toEqual(['s3'])
    })
  })

  describe('updateSessionsMeta — atomic patch', () => {
    it('serialises concurrent patches, no lost updates', async () => {
      // 30 parallel tagSession on disjoint ids — all must persist.
      const tasks = Array.from({ length: 30 }, (_, i) =>
        tagSession('stratex', `s${i}`, 'phil'),
      )
      await Promise.all(tasks)
      const meta = readSessionsMeta('stratex')
      expect(Object.keys(meta.sessions)).toHaveLength(30)
    })

    it('refuses to drop schemaVersion', async () => {
      await tagSession('stratex', 's1', 'phil')
      await expect(
        updateSessionsMeta('stratex', () => ({ schemaVersion: 99 as never, sessions: {} })),
      ).rejects.toThrow(/schemaVersion/)
    })
  })

  describe('Privacy-Strict — F9 Cross-WS-Isolation regression', () => {
    it('a session of WS-A is invisible from WS-B (different sessions-meta files)', async () => {
      await tagSession('stratex', 's1', 'phil')
      await tagSession('planb', 's2', 'phil')
      const stratexMeta = readSessionsMeta('stratex')
      const planbMeta = readSessionsMeta('planb')

      const visibleInStratex = filterVisibleSessions(
        [{ key: 's1' }, { key: 's2' }],
        'phil',
        stratexMeta,
      )
      // s2 is not in stratex's mapping → fail-closed.
      expect(visibleInStratex.map((s) => s.key)).toEqual(['s1'])

      const visibleInPlanb = filterVisibleSessions(
        [{ key: 's1' }, { key: 's2' }],
        'phil',
        planbMeta,
      )
      expect(visibleInPlanb.map((s) => s.key)).toEqual(['s2'])
    })
  })
})
