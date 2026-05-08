import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  AUDIT_SCHEMA_VERSION,
  appendAuditEvent,
  listAuditFiles,
  readAuditChain,
} from './audit-log'

describe('audit-log', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'audit-log-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
  })

  describe('appendAuditEvent', () => {
    it('writes a global event with chain fields', async () => {
      const entry = await appendAuditEvent('global', { type: 'login', userId: 'phil', ip: '1.2.3.4' })
      expect(entry.type).toBe('login')
      expect(entry.schemaVersion).toBe(AUDIT_SCHEMA_VERSION)
      expect(entry.prevHash).toBe('0'.repeat(64))
      expect(entry.thisHash).toMatch(/^[0-9a-f]{64}$/)
      expect(entry.userId).toBe('phil')
    })

    it('chains multiple events: prevHash[n+1] === thisHash[n]', async () => {
      const a = await appendAuditEvent('global', { type: 'login', userId: 'phil' })
      const b = await appendAuditEvent('global', { type: 'logout', userId: 'phil' })
      expect(b.prevHash).toBe(a.thisHash)
      expect(b.thisHash).not.toBe(a.thisHash)
    })

    it('caller cannot override system fields via spread', async () => {
      const entry = await appendAuditEvent('global', {
        type: 'login',
        prevHash: 'forged',
        thisHash: 'forged',
        schemaVersion: 99,
      } as never)
      expect(entry.schemaVersion).toBe(AUDIT_SCHEMA_VERSION)
      expect(entry.prevHash).toBe('0'.repeat(64))
      expect(entry.thisHash).not.toBe('forged')
    })

    it('writes workspace-scoped events under workspace dir', async () => {
      const entry = await appendAuditEvent(
        { type: 'workspace', wsId: 'stratex' },
        { type: 'member-add', userId: 'partner1' },
      )
      expect(entry.type).toBe('member-add')
      const files = listAuditFiles({ type: 'workspace', wsId: 'stratex' })
      expect(files.length).toBe(1)
    })

    it('rejects invalid wsId for workspace scope', async () => {
      await expect(
        appendAuditEvent({ type: 'workspace', wsId: '../escape' }, { type: 'evil' }),
      ).rejects.toThrow(/invalid wsId/)
    })

    it('rejects events with empty type', async () => {
      await expect(
        appendAuditEvent('global', { type: '' }),
      ).rejects.toThrow(/event\.type required/)
    })

    it('serialises concurrent appends — no torn lines', async () => {
      const N = 100
      const tasks = Array.from({ length: N }, (_, i) =>
        appendAuditEvent('global', { type: 'concurrent', i }),
      )
      const results = await Promise.all(tasks)
      expect(results).toHaveLength(N)

      // Read-side must produce N entries with an intact chain.
      const chain = readAuditChain('global')
      expect(chain.entries).toHaveLength(N)
      expect(chain.brokenAt).toBeNull()
    })
  })

  describe('readAuditChain — F10 Read-Validation', () => {
    it('reports an intact chain', async () => {
      await appendAuditEvent('global', { type: 'a' })
      await appendAuditEvent('global', { type: 'b' })
      await appendAuditEvent('global', { type: 'c' })
      const chain = readAuditChain('global')
      expect(chain.brokenAt).toBeNull()
      expect(chain.entries.map((e) => e.type)).toEqual(['a', 'b', 'c'])
    })

    it('detects tampering: a single field flipped without re-hash', async () => {
      const a = await appendAuditEvent('global', { type: 'login', userId: 'phil' })
      await appendAuditEvent('global', { type: 'logout', userId: 'phil' })

      // Tamper line 1: change userId without recomputing thisHash.
      const day = new Date().toISOString().slice(0, 10)
      const path = join(dataDir, 'global', 'audit', `${day}.jsonl`)
      const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.length > 0)
      const tampered = JSON.parse(lines[0]) as Record<string, unknown>
      tampered.userId = 'evil'
      lines[0] = JSON.stringify(tampered)
      writeFileSync(path, lines.join('\n') + '\n')

      const chain = readAuditChain('global')
      expect(chain.brokenAt).toBe(0)
      expect(chain.breakReason).toMatch(/thisHash mismatch/)
      // Entry is still surfaced so the UI can show what was tampered.
      expect(chain.entries[0].userId).toBe('evil')
      void a
    })

    it('detects deletion: a line removed mid-chain', async () => {
      await appendAuditEvent('global', { type: 'a' })
      await appendAuditEvent('global', { type: 'b' })
      await appendAuditEvent('global', { type: 'c' })

      const day = new Date().toISOString().slice(0, 10)
      const path = join(dataDir, 'global', 'audit', `${day}.jsonl`)
      const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.length > 0)
      // Remove line 1 (the 'b' entry). Line 2's prevHash now mismatches.
      const without = [lines[0], lines[2]].join('\n') + '\n'
      writeFileSync(path, without)

      const chain = readAuditChain('global')
      expect(chain.brokenAt).toBe(1)
      expect(chain.breakReason).toMatch(/prevHash mismatch/)
    })

    it('detects parse-error lines', async () => {
      await appendAuditEvent('global', { type: 'a' })
      const day = new Date().toISOString().slice(0, 10)
      const path = join(dataDir, 'global', 'audit', `${day}.jsonl`)
      const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.length > 0)
      lines.push('{ corrupt')
      writeFileSync(path, lines.join('\n') + '\n')

      const chain = readAuditChain('global')
      expect(chain.brokenAt).toBe(1)
      expect(chain.breakReason).toMatch(/parse error/)
    })

    it('returns empty for a missing file', () => {
      const chain = readAuditChain('global', '1999-01-01')
      expect(chain.entries).toEqual([])
      expect(chain.brokenAt).toBeNull()
    })
  })

  describe('listAuditFiles', () => {
    it('returns the JSONL files sorted', async () => {
      // Manually seed two day files
      const dir = join(dataDir, 'global', 'audit')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, '2026-05-08.jsonl'), '')
      writeFileSync(join(dir, '2026-05-07.jsonl'), '')
      writeFileSync(join(dir, 'README.md'), '') // ignored
      const files = listAuditFiles('global')
      expect(files).toEqual(['2026-05-07.jsonl', '2026-05-08.jsonl'])
    })

    it('returns empty for a missing dir', () => {
      expect(listAuditFiles('global')).toEqual([])
    })
  })

  // Acceptance: silence the unused-import lint
  void dirname
})
