import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  TOOL_NAMES,
  createServerContext,
  handleRequest,
  resolveSafe,
} from './federation-mcp-server'
import {
  _clearWorkspaceCachesForTests,
  addMember,
  createWorkspace,
} from './workspace-store'
import { createUser } from './users-store'

describe('federation-mcp-server', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'fed-mcp-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
    _clearWorkspaceCachesForTests()
    await createUser({ id: 'phil', email: 'p@x.y', name: 'Phil' })
    await createWorkspace({ id: 'stratex', name: 'Stratex', createdBy: 'phil' })
    await addMember({ wsId: 'stratex', userId: 'phil', role: 'owner', addedBy: 'phil' })
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
    _clearWorkspaceCachesForTests()
  })

  function seedWorkspaceTree() {
    const wsRoot = join(dataDir, 'workspaces', 'stratex')
    mkdirSync(join(wsRoot, 'memories'), { recursive: true })
    writeFileSync(join(wsRoot, 'memories', 'note.md'), '# hello federation')
    mkdirSync(join(wsRoot, 'memories', 'sub'), { recursive: true })
    writeFileSync(join(wsRoot, 'memories', 'sub', 'deep.md'), '## deep memory')
    mkdirSync(join(wsRoot, 'skills', 'researcher'), { recursive: true })
    writeFileSync(join(wsRoot, 'skills', 'researcher', 'SKILL.md'), '# researcher skill')
    mkdirSync(join(wsRoot, 'sessions', 'shared'), { recursive: true })
    writeFileSync(
      join(wsRoot, 'sessions', 'shared', 's1.json'),
      JSON.stringify({ schemaVersion: 1, sessionId: 's1', capturedAt: '2026-05-09T12:00:00Z', payload: { messages: [] } }),
    )
  }

  describe('createServerContext', () => {
    it('rejects invalid wsId', () => {
      expect(() => createServerContext('../escape')).toThrow(/invalid workspaceId/)
    })

    it('builds a context for a valid wsId', () => {
      const ctx = createServerContext('stratex')
      expect(ctx.workspaceId).toBe('stratex')
      expect(ctx.workspaceRoot).toMatch(/workspaces[\\/]stratex$/)
    })
  })

  describe('resolveSafe (Plan F2 path-traversal refusal)', () => {
    const ctx = { workspaceId: 'stratex', workspaceRoot: '/data/workspaces/stratex' }

    it('accepts a sub-path under the root', () => {
      expect(() => resolveSafe(ctx, 'memories/note.md')).not.toThrow()
    })

    it('refuses parent-traversal', () => {
      expect(() => resolveSafe(ctx, '../planb/secret.md')).toThrow(/PathTraversalRefused/)
      expect(() => resolveSafe(ctx, '../../etc/passwd')).toThrow(/PathTraversalRefused/)
      expect(() => resolveSafe(ctx, 'memories/../../planb/x')).toThrow(/PathTraversalRefused/)
    })

    it('refuses absolute paths', () => {
      expect(() => resolveSafe(ctx, '/etc/passwd')).toThrow(/PathTraversalRefused/)
    })

    it('refuses null bytes', () => {
      expect(() => resolveSafe(ctx, 'memories/note.md\0extra')).toThrow(/PathTraversalRefused/)
    })

    it('refuses empty path', () => {
      expect(() => resolveSafe(ctx, '')).toThrow(/PathTraversalRefused/)
    })
  })

  describe('TOOL_NAMES — Plan N11 7-tool set', () => {
    it('exposes exactly seven tool names', () => {
      expect(TOOL_NAMES).toHaveLength(7)
      expect(TOOL_NAMES).toEqual([
        'list_memories',
        'get_memory',
        'list_skills',
        'get_skill',
        'list_session_snapshots',
        'get_session_snapshot',
        'list_mission_events_since',
      ])
    })
  })

  describe('handleRequest — JSON-RPC dispatch', () => {
    beforeEach(() => seedWorkspaceTree())

    it('returns memories list with sha256 + size', async () => {
      const ctx = createServerContext('stratex')
      const res = await handleRequest(ctx, JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'list_memories',
      }))
      expect('result' in res).toBe(true)
      if ('result' in res) {
        const r = res.result as { files: Array<{ path: string; sha256: string }> }
        expect(r.files).toHaveLength(2)
        expect(r.files[0].path).toBe('memories/note.md')
        expect(r.files[0].sha256).toMatch(/^[0-9a-f]{64}$/)
      }
    })

    it('get_memory returns content + sha256', async () => {
      const ctx = createServerContext('stratex')
      const res = await handleRequest(ctx, JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'get_memory',
        params: { path: 'memories/note.md' },
      }))
      expect('result' in res).toBe(true)
      if ('result' in res) {
        const r = res.result as { content: string; sha256: string }
        expect(r.content).toContain('# hello federation')
      }
    })

    it('Plan F2 — get_memory with path-traversal returns PathTraversalRefused', async () => {
      const ctx = createServerContext('stratex')
      const res = await handleRequest(ctx, JSON.stringify({
        jsonrpc: '2.0', id: 3, method: 'get_memory',
        params: { path: '../planb/secret.md' },
      }))
      expect('error' in res).toBe(true)
      if ('error' in res) {
        expect(res.error.code).toBe(-32001)
        expect(res.error.message).toMatch(/PathTraversalRefused/)
      }
      // Audit-event written to global audit
      const fs = await import('node:fs')
      const day = new Date().toISOString().slice(0, 10)
      const auditPath = join(dataDir, 'global', 'audit', `${day}.jsonl`)
      const events = fs
        .readFileSync(auditPath, 'utf8')
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
      const violation = events.find((e) => e.type === 'mcp_path_traversal_attempt')
      expect(violation).toBeDefined()
      expect(violation?.workspaceId).toBe('stratex')
    })

    it('Plan F2 — get_memory rejects paths outside memories/', async () => {
      const ctx = createServerContext('stratex')
      const res = await handleRequest(ctx, JSON.stringify({
        jsonrpc: '2.0', id: 4, method: 'get_memory',
        params: { path: 'sessions/shared/s1.json' },
      }))
      expect('error' in res).toBe(true)
      if ('error' in res) expect(res.error.message).toMatch(/under memories\//)
    })

    it('list_skills + get_skill round-trip', async () => {
      const ctx = createServerContext('stratex')
      const list = await handleRequest(ctx, JSON.stringify({
        jsonrpc: '2.0', id: 5, method: 'list_skills',
      }))
      if ('result' in list) {
        const r = list.result as { skills: Array<{ name: string }> }
        expect(r.skills.map((s) => s.name)).toEqual(['researcher'])
      }
      const get = await handleRequest(ctx, JSON.stringify({
        jsonrpc: '2.0', id: 6, method: 'get_skill',
        params: { name: 'researcher' },
      }))
      if ('result' in get) {
        const r = get.result as { content: string }
        expect(r.content).toContain('# researcher skill')
      }
    })

    it('get_skill rejects path-y names', async () => {
      const ctx = createServerContext('stratex')
      const res = await handleRequest(ctx, JSON.stringify({
        jsonrpc: '2.0', id: 7, method: 'get_skill',
        params: { name: '../sessions/shared/s1' },
      }))
      expect('error' in res).toBe(true)
      if ('error' in res) expect(res.error.message).toMatch(/PathTraversalRefused/)
    })

    it('list_session_snapshots + get_session_snapshot return shared sessions only', async () => {
      const ctx = createServerContext('stratex')
      const list = await handleRequest(ctx, JSON.stringify({
        jsonrpc: '2.0', id: 8, method: 'list_session_snapshots',
      }))
      if ('result' in list) {
        const r = list.result as { sessions: Array<{ id: string }> }
        expect(r.sessions).toHaveLength(1)
        expect(r.sessions[0].id).toBe('s1')
      }
      const get = await handleRequest(ctx, JSON.stringify({
        jsonrpc: '2.0', id: 9, method: 'get_session_snapshot',
        params: { id: 's1' },
      }))
      if ('result' in get) {
        const r = get.result as { content: string }
        expect(r.content).toContain('"sessionId":"s1"')
      }
    })

    it('list_mission_events_since returns empty (Phase C placeholder)', async () => {
      const ctx = createServerContext('stratex')
      const res = await handleRequest(ctx, JSON.stringify({
        jsonrpc: '2.0', id: 10, method: 'list_mission_events_since',
        params: { sinceIndex: 0 },
      }))
      if ('result' in res) {
        const r = res.result as { events: Array<unknown>; total: number }
        expect(r.events).toEqual([])
        expect(r.total).toBe(0)
      }
    })

    it('returns -32601 MethodNotFound for unknown methods', async () => {
      const ctx = createServerContext('stratex')
      const res = await handleRequest(ctx, JSON.stringify({
        jsonrpc: '2.0', id: 11, method: 'list_users',
      }))
      expect('error' in res).toBe(true)
      if ('error' in res) {
        expect(res.error.code).toBe(-32601)
        expect(res.error.message).toMatch(/unknown method/)
      }
    })

    it('returns -32700 ParseError on invalid JSON', async () => {
      const ctx = createServerContext('stratex')
      const res = await handleRequest(ctx, '{ corrupt')
      expect('error' in res).toBe(true)
      if ('error' in res) expect(res.error.code).toBe(-32700)
    })

    it('returns -32602 InvalidParams when required params missing', async () => {
      const ctx = createServerContext('stratex')
      const res = await handleRequest(ctx, JSON.stringify({
        jsonrpc: '2.0', id: 12, method: 'get_memory',
        params: {},
      }))
      expect('error' in res).toBe(true)
      if ('error' in res) expect(res.error.code).toBe(-32602)
    })
  })
})
