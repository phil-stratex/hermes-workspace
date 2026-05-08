import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { appendErrorEntry } from './error-store'
import {
  formatErrorAsMarkdown,
  formatErrorsAsMarkdown,
} from './builder-brief'
import { runWithContext } from './request-context'

describe('builder-brief', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'builder-brief-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
  })

  describe('formatErrorAsMarkdown', () => {
    it('renders a complete single-error briefing', async () => {
      const e = await appendErrorEntry({
        level: 'error',
        source: 'backend',
        message: 'TypeError: foo is undefined',
        stack: 'Error: x\n    at handler (src/routes/api/x.ts:42:1)',
        context: { sessionKey: 's-123' },
        userId: 'phil',
        workspaceId: 'stratex',
        route: '/api/send-stream',
        requestId: 'req-abc',
      })
      const md = formatErrorAsMarkdown(e)
      expect(md).toContain('# Error Report')
      expect(md).toContain(`**ID:** \`${e.id}\``)
      expect(md).toContain('**Source:** backend')
      expect(md).toContain(`user \`phil\``)
      expect(md).toContain(`workspace \`stratex\``)
      expect(md).toContain('**Request-ID:**')
      expect(md).toContain('## Stack (redacted)')
      expect(md).toContain('## Context')
      expect(md).toContain('## Files likely involved')
      expect(md).toContain('src/routes/api/x.ts')
    })

    it('shows lastOccurrenceAt when occurrences > 1 (N1)', async () => {
      // first append + dedup hit
      await appendErrorEntry({ level: 'error', source: 'backend', message: 'loop' })
      const e = await appendErrorEntry({ level: 'error', source: 'backend', message: 'loop' })
      const md = formatErrorAsMarkdown(e)
      expect(md).toContain('Last seen:')
      expect(md).toContain('2× total')
    })

    it('omits sections that have no data', async () => {
      const e = await appendErrorEntry({
        level: 'warn',
        source: 'backend',
        message: 'simple',
      })
      const md = formatErrorAsMarkdown(e)
      expect(md).toContain('## Message')
      expect(md).not.toContain('## Stack')
      expect(md).not.toContain('## Context')
      expect(md).not.toContain('## Browser')
    })
  })

  describe('formatErrorsAsMarkdown (multi-select)', () => {
    it('builds a header summary + per-error sections for 3 entries', async () => {
      const a = await appendErrorEntry({
        level: 'error',
        source: 'backend',
        message: 'a-fail',
      })
      const b = await appendErrorEntry({
        level: 'warn',
        source: 'gateway',
        message: 'b-warn',
      })
      const c = await appendErrorEntry({
        level: 'fatal',
        source: 'backend',
        message: 'c-fatal',
      })
      const result = formatErrorsAsMarkdown({
        errorIds: [a.id, b.id, c.id],
      })
      expect(result.count).toBe(3)
      expect(result.missing).toEqual([])
      expect(result.markdown).toContain('# Error Briefing — 3 entries')
      expect(result.markdown).toContain('## Summary')
      expect(result.markdown).toMatch(/Counts:.*fatal/)
      expect(result.markdown).toMatch(/Counts:.*warn/)
      expect(result.markdown).toMatch(/Counts:.*error/)
      expect(result.markdown).toContain('a-fail')
      expect(result.markdown).toContain('b-warn')
      expect(result.markdown).toContain('c-fatal')
    })

    it('reports missing IDs in the result', async () => {
      const a = await appendErrorEntry({
        level: 'error',
        source: 'backend',
        message: 'real',
      })
      const result = formatErrorsAsMarkdown({
        errorIds: [a.id, 'deadbeef00000000', 'cafef00d00000000'],
      })
      expect(result.count).toBe(1)
      expect(result.missing).toHaveLength(2)
      expect(result.markdown).toContain('not found')
    })

    it('attaches related-logs when includeRelatedLogs=true', async () => {
      let target!: Awaited<ReturnType<typeof appendErrorEntry>>
      await runWithContext(
        {
          requestId: 'req-bb-1',
          userId: 'phil',
          workspaceId: 'stratex',
          route: '/api/x',
          method: 'GET',
          ip: null,
        },
        async () => {
          await appendErrorEntry({ level: 'info', source: 'backend', message: 'pre' })
          target = await appendErrorEntry({
            level: 'error',
            source: 'backend',
            message: 'main',
          })
          await appendErrorEntry({ level: 'info', source: 'backend', message: 'post' })
        },
      )
      const result = formatErrorsAsMarkdown({
        errorIds: [target.id],
        includeRelatedLogs: true,
      })
      expect(result.markdown).toContain('## Related logs')
      expect(result.markdown).toContain('pre')
      expect(result.markdown).toContain('post')
    })

    it('returns empty-message markdown for empty input set', () => {
      const result = formatErrorsAsMarkdown({
        errorIds: ['nonexistent-id-1', 'nonexistent-id-2'],
      })
      expect(result.count).toBe(0)
      expect(result.markdown).toContain('No matching error entries')
    })
  })
})
