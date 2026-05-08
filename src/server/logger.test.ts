import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { logger } from './logger'
import { runWithContext } from './request-context'
import { todayUTC } from './error-store'

function todaysFile(dataDir: string): string {
  return join(dataDir, 'global', 'errors', `${todayUTC()}.jsonl`)
}

function readEntries(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

/**
 * The logger's `persist()` is fire-and-forget — the call returns
 * before the file write resolves. For deterministic tests we yield to
 * the event loop a few times so the queued microtasks complete.
 */
async function flushPersist(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setImmediate(r))
  }
}

describe('logger', () => {
  let dataDir: string
  const originalEnv = { ...process.env }
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'logger-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
    logSpy.mockRestore()
  })

  describe('stdout output', () => {
    it('emits a JSON one-liner for warn/error/fatal', () => {
      logger.warn('test-warn')
      logger.error('test-error')
      logger.fatal('test-fatal')
      expect(logSpy).toHaveBeenCalledTimes(3)
      const all = logSpy.mock.calls.map((c) => JSON.parse(c[0] as string) as Record<string, unknown>)
      expect(all[0].level).toBe('warn')
      expect(all[0].msg).toBe('test-warn')
      expect(all[1].level).toBe('error')
      expect(all[2].level).toBe('fatal')
    })

    it('debug is silent unless HERMES_LOG_DEBUG=1', () => {
      logger.debug('quiet')
      expect(logSpy).not.toHaveBeenCalled()
      process.env.HERMES_LOG_DEBUG = '1'
      logger.debug('loud')
      expect(logSpy).toHaveBeenCalledTimes(1)
    })

    it('redacts cookies in stdout payload', () => {
      logger.warn('login fail', { headers: { cookie: 'session=abc' } })
      const payload = JSON.parse(logSpy.mock.calls[0][0] as string)
      expect((payload.ctx as { headers: { cookie: string } }).headers.cookie).toBe(
        '[REDACTED]',
      )
    })
  })

  describe('JSONL persistence', () => {
    it('persists warn/error/fatal by default', async () => {
      logger.warn('w')
      logger.error('e')
      logger.fatal('f')
      logger.info('i')
      logger.debug('d')
      await flushPersist()
      const entries = readEntries(todaysFile(dataDir))
      const levels = entries.map((e) => e.level).sort()
      expect(levels).toEqual(['error', 'fatal', 'warn'])
    })

    it('persists info too when HERMES_LOG_INFO_TO_FILE=1', async () => {
      process.env.HERMES_LOG_INFO_TO_FILE = '1'
      logger.info('i')
      await flushPersist()
      const entries = readEntries(todaysFile(dataDir))
      expect(entries.some((e) => e.level === 'info')).toBe(true)
    })

    it('does not persist debug', async () => {
      process.env.HERMES_LOG_DEBUG = '1'
      logger.debug('d')
      await flushPersist()
      const entries = readEntries(todaysFile(dataDir))
      expect(entries.find((e) => e.level === 'debug')).toBeUndefined()
    })

    it('redacts password fields in persisted context', async () => {
      logger.error('login fail', { password: 'secret', user: 'phil' })
      await flushPersist()
      const entries = readEntries(todaysFile(dataDir))
      const ctx = entries[0].context as { password: string; user: string }
      expect(ctx.password).toBe('[REDACTED]')
      expect(ctx.user).toBe('phil')
    })

    it('auto-pulls request-context into the persisted entry', async () => {
      await runWithContext(
        {
          requestId: 'r-logger-1',
          userId: 'phil',
          workspaceId: 'ws-1',
          route: '/api/x',
          method: 'GET',
          ip: '1.2.3.4',
        },
        async () => {
          logger.error('inside-request')
          await flushPersist()
        },
      )
      const entries = readEntries(todaysFile(dataDir))
      const e = entries[0] as Record<string, unknown>
      expect(e.requestId).toBe('r-logger-1')
      expect(e.userId).toBe('phil')
      expect(e.workspaceId).toBe('ws-1')
      expect(e.route).toBe('/api/x')
    })

    it('attaches Error.stack via the err parameter', async () => {
      const err = new Error('boom')
      logger.error('oops', undefined, err)
      await flushPersist()
      const entries = readEntries(todaysFile(dataDir))
      expect(entries[0].stack).toBeDefined()
      expect((entries[0].stack as string).length).toBeGreaterThan(0)
    })

    it('respects ctx.source override (e.g. "frontend")', async () => {
      logger.warn('client side', { source: 'frontend' })
      await flushPersist()
      const entries = readEntries(todaysFile(dataDir))
      expect(entries[0].source).toBe('frontend')
    })
  })
})
