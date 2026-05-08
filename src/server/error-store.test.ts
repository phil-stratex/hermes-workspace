import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  appendErrorEntry,
  findRelatedByRequestId,
  getErrorById,
  getErrorsDir,
  getHealthSummary,
  listErrors,
  todayUTC,
  validateChain,
} from './error-store'
import { runWithContext } from './request-context'

describe('error-store', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'error-store-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
  })

  describe('appendErrorEntry', () => {
    it('writes a single entry with hash-chain fields', async () => {
      const entry = await appendErrorEntry({
        level: 'error',
        source: 'backend',
        message: 'something broke',
      })
      expect(entry.schemaVersion).toBe(1)
      expect(entry.id).toMatch(/^[0-9a-f]{16}$/)
      expect(entry.prevHash).toBe('0'.repeat(64))
      expect(entry.thisHash).toMatch(/^[0-9a-f]{64}$/)
      expect(entry.dedupHash).toMatch(/^[0-9a-f]{64}$/)
      expect(entry.message).toBe('something broke')
      expect(entry.occurrences).toBeUndefined()
      expect(entry.lastOccurrenceAt).toBeUndefined()
    })

    it('chains successive entries: prevHash[N+1] === thisHash[N]', async () => {
      const a = await appendErrorEntry({ level: 'error', source: 'backend', message: 'a' })
      const b = await appendErrorEntry({ level: 'error', source: 'backend', message: 'b' })
      expect(b.prevHash).toBe(a.thisHash)
      expect(b.thisHash).not.toBe(a.thisHash)
    })

    it('redacts cookies/passwords in context before persistence', async () => {
      const entry = await appendErrorEntry({
        level: 'warn',
        source: 'auth',
        message: 'login failed',
        context: { headers: { cookie: 'session=abc' }, password: 'secret123' },
      })
      const ctx = entry.context as { headers: { cookie: string }; password: string }
      expect(ctx.headers.cookie).toBe('[REDACTED]')
      expect(ctx.password).toBe('[REDACTED]')
    })

    it('auto-pulls requestId/userId/route from request-context', async () => {
      let entry: Awaited<ReturnType<typeof appendErrorEntry>>
      await runWithContext(
        {
          requestId: 'req-test-1',
          userId: 'phil',
          workspaceId: 'ws-1',
          route: '/api/x',
          method: 'POST',
          ip: '1.2.3.4',
        },
        async () => {
          entry = await appendErrorEntry({
            level: 'error',
            source: 'backend',
            message: 'context-pull-test',
          })
        },
      )
      expect(entry!.requestId).toBe('req-test-1')
      expect(entry!.userId).toBe('phil')
      expect(entry!.workspaceId).toBe('ws-1')
      expect(entry!.route).toBe('/api/x')
      expect(entry!.method).toBe('POST')
      expect(entry!.ip).toBe('1.2.3.4')
    })

    it('explicit input wins over request-context', async () => {
      let entry: Awaited<ReturnType<typeof appendErrorEntry>>
      await runWithContext(
        {
          requestId: 'req-from-ctx',
          userId: 'ctx-user',
          workspaceId: null,
          route: null,
          method: null,
          ip: null,
        },
        async () => {
          entry = await appendErrorEntry({
            level: 'error',
            source: 'backend',
            message: 'override-test',
            userId: 'explicit-user',
          })
        },
      )
      expect(entry!.userId).toBe('explicit-user')
      expect(entry!.requestId).toBe('req-from-ctx')
    })
  })

  describe('auto-dedup (N1 lastOccurrenceAt)', () => {
    it('100 identical errors within 60s collapse into one entry with occurrences', async () => {
      const N = 100
      for (let i = 0; i < N; i++) {
        await appendErrorEntry({
          level: 'error',
          source: 'backend',
          message: 'tight-loop error',
        })
      }
      const today = todayUTC()
      const file = join(getErrorsDir(), `${today}.jsonl`)
      const lines = readFileSync(file, 'utf8').trim().split('\n')
      expect(lines.length).toBe(1)
      const e = JSON.parse(lines[0])
      expect(e.occurrences).toBe(N)
      expect(e.lastOccurrenceAt).toBeDefined()
      expect(new Date(e.lastOccurrenceAt).getTime()).toBeGreaterThanOrEqual(
        new Date(e.ts).getTime(),
      )
    })

    it('different messages do not dedup', async () => {
      await appendErrorEntry({ level: 'error', source: 'backend', message: 'A' })
      await appendErrorEntry({ level: 'error', source: 'backend', message: 'B' })
      await appendErrorEntry({ level: 'error', source: 'backend', message: 'A' })
      const today = todayUTC()
      const file = join(getErrorsDir(), `${today}.jsonl`)
      const lines = readFileSync(file, 'utf8').trim().split('\n')
      // A1, B, A2 — A1 and A2 don't collapse because B is between them
      expect(lines.length).toBe(3)
    })

    it('different routes/users do not dedup even with same message', async () => {
      await runWithContext(
        {
          requestId: 'r1',
          userId: 'alice',
          workspaceId: null,
          route: '/x',
          method: null,
          ip: null,
        },
        async () => {
          await appendErrorEntry({ level: 'error', source: 'backend', message: 'err' })
        },
      )
      await runWithContext(
        {
          requestId: 'r2',
          userId: 'bob',
          workspaceId: null,
          route: '/x',
          method: null,
          ip: null,
        },
        async () => {
          await appendErrorEntry({ level: 'error', source: 'backend', message: 'err' })
        },
      )
      const today = todayUTC()
      const file = join(getErrorsDir(), `${today}.jsonl`)
      const lines = readFileSync(file, 'utf8').trim().split('\n')
      expect(lines.length).toBe(2)
    })

    it('hash-chain stays valid after dedup rewrite', async () => {
      await appendErrorEntry({ level: 'error', source: 'backend', message: 'x' })
      await appendErrorEntry({ level: 'error', source: 'backend', message: 'x' })
      await appendErrorEntry({ level: 'error', source: 'backend', message: 'x' })
      const today = todayUTC()
      const result = validateChain(today)
      expect(result.brokenAt).toBeNull()
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].occurrences).toBe(3)
    })
  })

  describe('parallel appends', () => {
    it('50 parallel appends do not lose entries (mutex)', async () => {
      const N = 50
      const tasks: Array<Promise<unknown>> = []
      for (let i = 0; i < N; i++) {
        tasks.push(
          appendErrorEntry({
            level: 'warn',
            source: 'backend',
            message: `parallel-${i}`,
          }),
        )
      }
      await Promise.all(tasks)
      const today = todayUTC()
      const file = join(getErrorsDir(), `${today}.jsonl`)
      const lines = readFileSync(file, 'utf8').trim().split('\n')
      expect(lines.length).toBe(N) // 50 different messages → no dedup
    })
  })

  describe('listErrors filters', () => {
    beforeEach(async () => {
      // Seed with mixed entries
      await appendErrorEntry({ level: 'error', source: 'backend', message: 'be-1' })
      await appendErrorEntry({ level: 'warn', source: 'gateway', message: 'gw-1' })
      await appendErrorEntry({ level: 'fatal', source: 'swarm', message: 'sw-1' })
      await appendErrorEntry({
        level: 'error',
        source: 'test',
        message: 'tst-1',
      })
    })

    it('hides source:test by default', () => {
      const r = listErrors({})
      const sources = r.entries.map((e) => e.source)
      expect(sources).not.toContain('test')
      expect(r.total).toBe(3)
    })

    it('shows source:test with includeTest=true', () => {
      const r = listErrors({ includeTest: true })
      const sources = r.entries.map((e) => e.source)
      expect(sources).toContain('test')
    })

    it('filters by level', () => {
      const r = listErrors({ level: ['fatal'] })
      expect(r.entries).toHaveLength(1)
      expect(r.entries[0].level).toBe('fatal')
    })

    it('filters by source', () => {
      const r = listErrors({ source: ['gateway'] })
      expect(r.entries).toHaveLength(1)
      expect(r.entries[0].source).toBe('gateway')
    })

    it('search matches message substring (case-insensitive)', () => {
      const r = listErrors({ search: 'GW' })
      expect(r.entries).toHaveLength(1)
      expect(r.entries[0].source).toBe('gateway')
    })

    it('honours limit + offset', () => {
      const a = listErrors({ limit: 2, offset: 0 })
      const b = listErrors({ limit: 2, offset: 2 })
      expect(a.entries).toHaveLength(2)
      expect(b.entries.length).toBeGreaterThan(0)
      const allIds = new Set([...a.entries, ...b.entries].map((e) => e.id))
      expect(allIds.size).toBe(a.entries.length + b.entries.length)
    })
  })

  describe('getErrorById', () => {
    it('returns the entry by id', async () => {
      const entry = await appendErrorEntry({
        level: 'error',
        source: 'backend',
        message: 'lookup-test',
      })
      const found = getErrorById(entry.id)
      expect(found?.message).toBe('lookup-test')
    })
    it('returns null for unknown id', () => {
      expect(getErrorById('deadbeef00000000')).toBeNull()
    })
  })

  describe('findRelatedByRequestId', () => {
    it('returns entries within the time window', async () => {
      await runWithContext(
        {
          requestId: 'req-A',
          userId: null,
          workspaceId: null,
          route: '/x',
          method: null,
          ip: null,
        },
        async () => {
          await appendErrorEntry({ level: 'info', source: 'backend', message: 'start' })
          await appendErrorEntry({ level: 'error', source: 'backend', message: 'middle' })
          await appendErrorEntry({ level: 'info', source: 'backend', message: 'end' })
        },
      )
      const related = findRelatedByRequestId('req-A')
      expect(related.length).toBeGreaterThanOrEqual(3)
    })
    it('returns empty when no entries match', () => {
      expect(findRelatedByRequestId('does-not-exist')).toEqual([])
    })
  })

  describe('getHealthSummary', () => {
    it('counts entries by level in the window', async () => {
      await appendErrorEntry({ level: 'fatal', source: 'backend', message: 'f1' })
      await appendErrorEntry({ level: 'error', source: 'backend', message: 'e1' })
      await appendErrorEntry({ level: 'error', source: 'backend', message: 'e2' })
      await appendErrorEntry({ level: 'warn', source: 'backend', message: 'w1' })
      const h = getHealthSummary()
      expect(h.counts.fatal).toBeGreaterThanOrEqual(1)
      expect(h.counts.error).toBeGreaterThanOrEqual(2)
      expect(h.counts.warn).toBeGreaterThanOrEqual(1)
    })
  })

  describe('validateChain', () => {
    it('returns brokenAt: null for an unmodified chain', async () => {
      await appendErrorEntry({ level: 'error', source: 'backend', message: 'a' })
      await appendErrorEntry({ level: 'error', source: 'backend', message: 'b' })
      await appendErrorEntry({ level: 'error', source: 'backend', message: 'c' })
      expect(validateChain(todayUTC()).brokenAt).toBeNull()
    })

    it('detects a tampered line', async () => {
      await appendErrorEntry({ level: 'error', source: 'backend', message: 'a' })
      await appendErrorEntry({ level: 'error', source: 'backend', message: 'b' })
      const today = todayUTC()
      const file = join(getErrorsDir(), `${today}.jsonl`)
      const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l)
      const tampered = JSON.parse(lines[1])
      tampered.message = 'CHANGED'
      const newContent = lines[0] + '\n' + JSON.stringify(tampered) + '\n'
      const fs = await import('node:fs')
      fs.writeFileSync(file, newContent)
      const r = validateChain(today)
      expect(r.brokenAt).toBe(1)
    })
  })

  describe('source: test entries persist with correct tag', () => {
    it('always source-tagged regardless of caller intent', async () => {
      const e = await appendErrorEntry({
        level: 'error',
        source: 'test',
        message: 'manual',
      })
      expect(e.source).toBe('test')
      // listErrors hides them by default
      const r = listErrors({})
      expect(r.total).toBe(0)
      expect(r.entries).toHaveLength(0)
    })
  })

  it('writes file under data/global/errors/<date>.jsonl', async () => {
    await appendErrorEntry({ level: 'error', source: 'backend', message: 'fs-check' })
    const today = todayUTC()
    const expected = join(dataDir, 'global', 'errors', `${today}.jsonl`)
    expect(existsSync(expected)).toBe(true)
  })
})
