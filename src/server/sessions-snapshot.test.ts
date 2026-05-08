import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _mutexChainsSizeForTests } from './atomic-write'
import {
  SNAPSHOT_FRESHNESS_MS,
  captureInitialSnapshot,
  ensureFreshSnapshot,
  snapshotPath,
} from './sessions-snapshot'
import type { SnapshotFetcher } from './sessions-snapshot'
import {
  readSessionsMeta,
  shareSession,
  tagSession,
  updateSessionsMeta,
} from './sessions-privacy'

describe('sessions-snapshot', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sessions-snap-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
  })

  function fakeFetcher(payload: unknown, messageCount = 7): SnapshotFetcher {
    return async () => ({ payload, messageCount })
  }

  describe('captureInitialSnapshot', () => {
    it('writes the snapshot file + updates sessions-meta', async () => {
      await tagSession('stratex', 's1', 'phil')
      const snapshot = await captureInitialSnapshot({
        wsId: 'stratex',
        sessionId: 's1',
        fetcher: fakeFetcher({ messages: ['hi'] }, 1),
      })
      expect(snapshot.sessionId).toBe('s1')
      expect(snapshot.ownerId).toBe('phil')
      expect(snapshot.messageCount).toBe(1)

      const path = snapshotPath('stratex', 's1')
      expect(existsSync(path)).toBe(true)
      const onDisk = JSON.parse(readFileSync(path, 'utf8'))
      expect(onDisk.payload).toEqual({ messages: ['hi'] })

      const meta = readSessionsMeta('stratex')
      expect(meta.sessions.s1.snapshotPath).toBe('sessions/shared/s1.json')
      expect(meta.sessions.s1.snapshotUpdatedAt).toBe(snapshot.capturedAt)
      expect(meta.sessions.s1.snapshotMessageCount).toBe(1)
    })

    it('refuses untagged session', async () => {
      await expect(
        captureInitialSnapshot({
          wsId: 'stratex',
          sessionId: 'unknown',
          fetcher: fakeFetcher({}),
        }),
      ).rejects.toThrow(/cannot snapshot untagged/)
    })
  })

  describe('ensureFreshSnapshot — Lazy + Mutex (R6/N7)', () => {
    beforeEach(async () => {
      await tagSession('stratex', 's1', 'phil')
      await shareSession({ wsId: 'stratex', sessionId: 's1', sharedBy: 'phil' })
      await captureInitialSnapshot({
        wsId: 'stratex',
        sessionId: 's1',
        fetcher: fakeFetcher({ initial: true }, 5),
      })
    })

    it('returns null for an unshared session (fail-closed)', async () => {
      await tagSession('stratex', 's2', 'phil')
      const result = await ensureFreshSnapshot({
        wsId: 'stratex',
        sessionId: 's2',
        fetcher: fakeFetcher({ should_not: 'be called' }),
      })
      expect(result.snapshot).toBeNull()
      expect(result.refreshed).toBe(false)
    })

    it('returns the existing snapshot when fresh', async () => {
      const fetcher = vi.fn(fakeFetcher({ should_not: 'be called' }))
      const result = await ensureFreshSnapshot({
        wsId: 'stratex',
        sessionId: 's1',
        fetcher,
      })
      expect(result.snapshot).not.toBeNull()
      expect(result.refreshed).toBe(false)
      expect(fetcher).not.toHaveBeenCalled()
    })

    it('refreshes when activity advanced past snapshotUpdatedAt + 10min', async () => {
      // Force the meta to look stale: snapshotUpdatedAt 11min ago,
      // lastActivityAt 1min ago.
      const stalePast = new Date(Date.now() - 11 * 60 * 1000).toISOString()
      const recent = new Date(Date.now() - 60 * 1000).toISOString()
      await updateSessionsMeta('stratex', (current) => ({
        schemaVersion: 1,
        sessions: {
          ...current.sessions,
          s1: {
            ...current.sessions.s1,
            snapshotUpdatedAt: stalePast,
            lastActivityAt: recent,
          },
        },
      }))
      const fetcher = vi.fn(fakeFetcher({ refreshed: true }, 8))
      const result = await ensureFreshSnapshot({
        wsId: 'stratex',
        sessionId: 's1',
        fetcher,
      })
      expect(result.refreshed).toBe(true)
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(result.snapshot?.messageCount).toBe(8)
    })

    it('Thundering-Herd: 50 parallel reads on stale → exactly 1 fetcher call', async () => {
      const stalePast = new Date(Date.now() - 11 * 60 * 1000).toISOString()
      const recent = new Date(Date.now() - 60 * 1000).toISOString()
      await updateSessionsMeta('stratex', (current) => ({
        schemaVersion: 1,
        sessions: {
          ...current.sessions,
          s1: {
            ...current.sessions.s1,
            snapshotUpdatedAt: stalePast,
            lastActivityAt: recent,
          },
        },
      }))
      let calls = 0
      const slowFetcher: SnapshotFetcher = async () => {
        calls++
        await new Promise((r) => setTimeout(r, 30))
        return { payload: { v: calls }, messageCount: 9 }
      }
      const tasks = Array.from({ length: 50 }, () =>
        ensureFreshSnapshot({ wsId: 'stratex', sessionId: 's1', fetcher: slowFetcher }),
      )
      await Promise.all(tasks)
      expect(calls).toBe(1)
    })

    it('on fetcher failure, returns existing snapshot with stale=true', async () => {
      const stalePast = new Date(Date.now() - 11 * 60 * 1000).toISOString()
      const recent = new Date(Date.now() - 60 * 1000).toISOString()
      await updateSessionsMeta('stratex', (current) => ({
        schemaVersion: 1,
        sessions: {
          ...current.sessions,
          s1: {
            ...current.sessions.s1,
            snapshotUpdatedAt: stalePast,
            lastActivityAt: recent,
          },
        },
      }))
      const failingFetcher: SnapshotFetcher = async () => {
        throw new Error('gateway down')
      }
      const result = await ensureFreshSnapshot({
        wsId: 'stratex',
        sessionId: 's1',
        fetcher: failingFetcher,
      })
      expect(result.stale).toBe(true)
      expect(result.refreshed).toBe(false)
      expect(result.snapshot).not.toBeNull()
    })

    it('N7 mutex-keys clean up after settle', async () => {
      // Use unique session ids per call so the mutex map would grow
      // monotonically without N7's self-cleanup-finally.
      const sizeBefore = _mutexChainsSizeForTests()
      const tasks = Array.from({ length: 25 }, async (_, i) => {
        await tagSession('stratex', `s-uniq-${i}`, 'phil')
        await shareSession({
          wsId: 'stratex',
          sessionId: `s-uniq-${i}`,
          sharedBy: 'phil',
        })
        await captureInitialSnapshot({
          wsId: 'stratex',
          sessionId: `s-uniq-${i}`,
          fetcher: fakeFetcher({ i }),
        })
      })
      await Promise.all(tasks)
      await new Promise((r) => setImmediate(r))
      // Map either back to baseline or near it (audit/meta mutexes
      // share keys across calls; snapshot keys are unique per session).
      expect(_mutexChainsSizeForTests()).toBeLessThanOrEqual(sizeBefore + 1)
    })
  })

  describe('snapshotPath', () => {
    it('returns the canonical path under workspaceDir', () => {
      const path = snapshotPath('stratex', 'abc-123')
      expect(path).toMatch(/workspaces[\\/]stratex[\\/]sessions[\\/]shared[\\/]abc-123\.json$/)
    })
  })

  it('SNAPSHOT_FRESHNESS_MS = 10 minutes', () => {
    expect(SNAPSHOT_FRESHNESS_MS).toBe(10 * 60 * 1000)
  })
})
