import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { withMutex } from './atomic-write'
import { appendErrorEntry, getErrorsDir } from './error-store'
import { runErrorRetention } from './error-retention'
import { _clearGlobalSettingsCacheForTests, setErrorRetentionDays } from './global-settings'

function dateString(daysAgo: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

function seedFile(dataDir: string, dateISO: string, content: string): string {
  const dir = join(dataDir, 'global', 'errors')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${dateISO}.jsonl`)
  writeFileSync(path, content)
  return path
}

describe('error-retention', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'error-retention-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
    _clearGlobalSettingsCacheForTests()
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
    _clearGlobalSettingsCacheForTests()
  })

  it('deletes files older than retentionDays, keeps newer ones', async () => {
    seedFile(dataDir, dateString(45), '{"x":1}\n')
    seedFile(dataDir, dateString(31), '{"x":1}\n')
    seedFile(dataDir, dateString(10), '{"x":1}\n')
    seedFile(dataDir, dateString(0), '{"x":1}\n')

    const result = await runErrorRetention()
    expect(result.deleted.sort()).toEqual(
      [`${dateString(45)}.jsonl`, `${dateString(31)}.jsonl`].sort(),
    )
    expect(result.kept.sort()).toEqual(
      [`${dateString(10)}.jsonl`, `${dateString(0)}.jsonl`].sort(),
    )
    expect(existsSync(join(dataDir, 'global', 'errors', `${dateString(45)}.jsonl`))).toBe(false)
    expect(existsSync(join(dataDir, 'global', 'errors', `${dateString(10)}.jsonl`))).toBe(true)
  })

  it('respects custom retentionDays from global-settings', async () => {
    await setErrorRetentionDays(7, 'phil')
    seedFile(dataDir, dateString(10), '{"x":1}\n')
    seedFile(dataDir, dateString(3), '{"x":1}\n')

    const result = await runErrorRetention()
    expect(result.deleted).toContain(`${dateString(10)}.jsonl`)
    expect(result.kept).toContain(`${dateString(3)}.jsonl`)
  })

  it('returns empty when errors dir does not exist', async () => {
    const result = await runErrorRetention()
    expect(result.deleted).toEqual([])
    expect(result.kept).toEqual([])
  })

  it('ignores non-jsonl files in the errors dir', async () => {
    mkdirSync(join(dataDir, 'global', 'errors'), { recursive: true })
    writeFileSync(join(dataDir, 'global', 'errors', 'README.md'), '# notes')
    seedFile(dataDir, dateString(45), '{"x":1}\n')

    const result = await runErrorRetention()
    expect(result.deleted).toEqual([`${dateString(45)}.jsonl`])
    expect(existsSync(join(dataDir, 'global', 'errors', 'README.md'))).toBe(true)
  })

  describe('I1 — race-safety against concurrent appends', () => {
    it('an append on a kept date does not collide with retention deleting an older date', async () => {
      // 45-day-old file (eligible for deletion)
      seedFile(dataDir, dateString(45), '{"x":1}\n')

      // Schedule a parallel append to TODAY's date (kept).
      const appendP = appendErrorEntry({
        level: 'error',
        source: 'backend',
        message: 'parallel',
      })

      const retentionP = runErrorRetention()

      const [, retention] = await Promise.all([appendP, retentionP])
      // Older file is gone, newer (today's) one still has the entry.
      expect(retention.deleted).toContain(`${dateString(45)}.jsonl`)
      const todayPath = join(dataDir, 'global', 'errors', `${dateString(0)}.jsonl`)
      expect(existsSync(todayPath)).toBe(true)
      const lines = readFileSync(todayPath, 'utf8').trim().split('\n')
      expect(lines.length).toBe(1)
    })

    it('uses per-date mutex (errors:<date>) so a writer holding the same lock blocks unlink', async () => {
      const oldDate = dateString(45)
      seedFile(dataDir, oldDate, '{"x":1}\n')

      const order: Array<string> = []
      // Hold the per-date mutex on the OLD date for 100 ms — runErrorRetention
      // must wait on this exact key to attempt unlink.
      const writerP = withMutex(`errors:${oldDate}`, async () => {
        order.push('writer-start')
        await new Promise((r) => setTimeout(r, 100))
        order.push('writer-done')
      })
      // Yield to let the writer actually acquire the slot before we
      // schedule the retention pass.
      await Promise.resolve()
      const retentionP = runErrorRetention().then((r) => {
        order.push('retention-done')
        return r
      })

      await Promise.all([writerP, retentionP])
      // The writer started first; retention completed only after it.
      expect(order[0]).toBe('writer-start')
      expect(order[order.length - 1]).toBe('retention-done')
    })
  })
})
