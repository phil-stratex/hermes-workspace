import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import {
  MASS_DELETE_COUNT_THRESHOLD,
  MASS_DELETE_PERCENT_THRESHOLD,
  applyDiff,
  computeDiff,
  computeMassDeleteWarnings,
  readBaseline,
  _internal,
} from './federation-sync-engine'
import {
  _clearWorkspaceCachesForTests,
  addMember,
  createWorkspace,
} from './workspace-store'
import { createUser } from './users-store'

function sha(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

describe('federation-sync-engine', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'fed-sync-'))
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

  function seedLocalMemory(name: string, content: string): string {
    const path = join(dataDir, 'workspaces', 'stratex', 'memories', name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, content)
    return sha(content)
  }

  function seedLocalSkill(name: string, content: string): string {
    const path = join(dataDir, 'workspaces', 'stratex', 'skills', name, 'SKILL.md')
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, content)
    return sha(content)
  }

  describe('computeMassDeleteWarnings (Plan B.5)', () => {
    it('flags >50 incoming tombstones', () => {
      const w = computeMassDeleteWarnings(MASS_DELETE_COUNT_THRESHOLD + 1, 0, 1000, 1000)
      expect(w.massInDelete).toBe(true)
      expect(w.massOutDelete).toBe(false)
    })

    it('flags >30% of pool', () => {
      const w = computeMassDeleteWarnings(35, 0, 100, 100)
      expect(w.massInDelete).toBe(true)
    })

    it('respects pool-min 10 (no false-positive on tiny pools)', () => {
      // 1 delete out of 1 item is 100% of the raw pool, but
      // ratio = 1/max(1,10) = 0.1 < 0.3 → no panic.
      const w = computeMassDeleteWarnings(1, 0, 1, 1)
      expect(w.massInDelete).toBe(false)
      // 2 deletes out of 2 items: 2/max(2,10) = 0.2 < 0.3 → still no
      const w2 = computeMassDeleteWarnings(2, 0, 2, 2)
      expect(w2.massInDelete).toBe(false)
    })

    it('triggers when ratio exceeds threshold even with min-pool clamp', () => {
      // 4 deletes / max(5,10) = 0.4 > 0.3 → triggers.
      // Plan B.5 threshold: this is the intended semantics — even
      // with the min-pool clamp, large *fractions* of deletes count.
      const w = computeMassDeleteWarnings(4, 0, 5, 5)
      expect(w.massInDelete).toBe(true)
    })

    it('returns false-false for a quiet sync', () => {
      const w = computeMassDeleteWarnings(2, 1, 100, 100)
      expect(w.massInDelete).toBe(false)
      expect(w.massOutDelete).toBe(false)
    })
  })

  describe('computeDiff — basic shape', () => {
    it('reports add/update/delete on memories vs remote', () => {
      seedLocalMemory('common.md', 'local-common-A')
      seedLocalMemory('only-local.md', 'X')
      // Pretend remote has: common.md (different content), only-remote.md
      const remote = {
        memories: new Map<string, string>([
          ['memories/common.md', sha('remote-common-B')],
          ['memories/only-remote.md', sha('Y')],
        ]),
        skills: new Map<string, string>(),
        sessionSnapshots: new Map<string, string>(),
      }
      const diff = computeDiff({
        wsId: 'stratex',
        peerId: 'p1',
        syncedTypes: ['memories'],
        remote,
      })
      // common.md is on both, no baseline → conflict
      expect(diff.conflicts).toHaveLength(1)
      expect(diff.conflicts[0].path).toBe('memories/common.md')
      // only-remote.md is incoming add
      const inAdd = diff.inItems.find((i) => i.path === 'memories/only-remote.md')
      expect(inAdd?.op).toBe('add')
      // only-local.md is outgoing add
      const outAdd = diff.outItems.find((i) => i.path === 'memories/only-local.md')
      expect(outAdd?.op).toBe('add')
    })

    it('uses baseline to attribute changes (Plan AK28 time-skew-robust)', () => {
      const localContent = 'local-changed'
      seedLocalMemory('shared.md', localContent)
      const baselinePath = join(
        dataDir, 'workspaces', 'stratex', 'federation', 'peers-baselines', 'p1.json',
      )
      mkdirSync(join(baselinePath, '..'), { recursive: true })
      const baselineHash = sha('shared-original')
      writeFileSync(baselinePath, JSON.stringify({
        schemaVersion: 1, peerId: 'p1', updatedAt: '2026-05-09T00:00:00Z',
        paths: { 'memories/shared.md': baselineHash },
      }))

      // Remote unchanged from baseline → local-only change → outgoing
      const remoteUnchanged = {
        memories: new Map<string, string>([['memories/shared.md', baselineHash]]),
        skills: new Map<string, string>(),
        sessionSnapshots: new Map<string, string>(),
      }
      const diff1 = computeDiff({
        wsId: 'stratex', peerId: 'p1', syncedTypes: ['memories'], remote: remoteUnchanged,
      })
      expect(diff1.outItems).toHaveLength(1)
      expect(diff1.outItems[0].op).toBe('update')
      expect(diff1.conflicts).toHaveLength(0)

      // Remote changed from baseline → both sides changed → conflict
      const remoteAlsoChanged = {
        memories: new Map<string, string>([['memories/shared.md', sha('remote-also-different')]]),
        skills: new Map<string, string>(),
        sessionSnapshots: new Map<string, string>(),
      }
      const diff2 = computeDiff({
        wsId: 'stratex', peerId: 'p1', syncedTypes: ['memories'], remote: remoteAlsoChanged,
      })
      expect(diff2.conflicts).toHaveLength(1)
    })

    it('reports incoming delete when baseline has path but remote does not', () => {
      seedLocalMemory('keepable.md', 'still-here')
      const baselinePath = join(
        dataDir, 'workspaces', 'stratex', 'federation', 'peers-baselines', 'p1.json',
      )
      mkdirSync(join(baselinePath, '..'), { recursive: true })
      writeFileSync(baselinePath, JSON.stringify({
        schemaVersion: 1, peerId: 'p1', updatedAt: '2026-05-09T00:00:00Z',
        paths: { 'memories/keepable.md': sha('still-here') },
      }))
      const remote = {
        memories: new Map<string, string>(),
        skills: new Map<string, string>(),
        sessionSnapshots: new Map<string, string>(),
      }
      const diff = computeDiff({
        wsId: 'stratex', peerId: 'p1', syncedTypes: ['memories'], remote,
      })
      expect(diff.inItems).toHaveLength(1)
      expect(diff.inItems[0].op).toBe('delete')
      expect(diff.warnings.detail.inDeleteCount).toBe(1)
    })

    it('outgoing delete when local has tombstone but remote still has live', () => {
      const livePath = join(dataDir, 'workspaces', 'stratex', 'memories', 'old.md.deleted')
      mkdirSync(join(livePath, '..'), { recursive: true })
      writeFileSync(livePath, '')
      const remote = {
        memories: new Map<string, string>([['memories/old.md', sha('still-on-remote')]]),
        skills: new Map<string, string>(),
        sessionSnapshots: new Map<string, string>(),
      }
      const diff = computeDiff({
        wsId: 'stratex', peerId: 'p1', syncedTypes: ['memories'], remote,
      })
      expect(diff.outItems).toHaveLength(1)
      expect(diff.outItems[0].op).toBe('delete')
      expect(diff.warnings.detail.outDeleteCount).toBe(1)
    })

    it('skills + session-snapshots are diffed when in syncedTypes', () => {
      seedLocalSkill('researcher', 'local-skill')
      const remote = {
        memories: new Map<string, string>(),
        skills: new Map<string, string>([['skills/researcher/SKILL.md', sha('remote-skill')]]),
        sessionSnapshots: new Map<string, string>([
          ['sessions/shared/s1.json', sha('{"x":1}')],
        ]),
      }
      const diff = computeDiff({
        wsId: 'stratex', peerId: 'p1',
        syncedTypes: ['skills', 'sessions-shared'],
        remote,
      })
      expect(diff.inItems.find((i) => i.path === 'sessions/shared/s1.json')?.op).toBe('add')
      expect(diff.conflicts.find((c) => c.path === 'skills/researcher/SKILL.md')).toBeDefined()
    })
  })

  describe('applyDiff — selective + baseline updates', () => {
    it('writes incoming files and updates baseline', async () => {
      const remoteContent = 'remote-content'
      const remoteHash = sha(remoteContent)
      const diff = {
        inItems: [{ kind: 'memory' as const, path: 'memories/incoming.md', op: 'add' as const, remoteSha256: remoteHash }],
        outItems: [],
        conflicts: [],
        warnings: { massInDelete: false, massOutDelete: false, detail: { inDeleteCount: 0, outDeleteCount: 0, inPoolSize: 0, outPoolSize: 0 } },
      }
      const result = await applyDiff({
        wsId: 'stratex', peerId: 'p1', diff,
        selective: [{ path: 'memories/incoming.md', remoteSha256: remoteHash }],
        actorUserId: 'phil',
        fetchRemoteContent: async () => remoteContent,
      })
      expect(result.applied.add).toBe(1)
      const target = join(dataDir, 'workspaces', 'stratex', 'memories', 'incoming.md')
      expect(existsSync(target)).toBe(true)
      expect(readFileSync(target, 'utf8')).toBe(remoteContent)
      const baseline = readBaseline('stratex', 'p1')
      expect(baseline.paths['memories/incoming.md']).toBe(remoteHash)
    })

    it('skips items not in selective[] (operator opt-out)', async () => {
      const diff = {
        inItems: [{ kind: 'memory' as const, path: 'memories/yes.md', op: 'add' as const, remoteSha256: sha('y') },
                  { kind: 'memory' as const, path: 'memories/no.md', op: 'add' as const, remoteSha256: sha('n') }],
        outItems: [],
        conflicts: [],
        warnings: { massInDelete: false, massOutDelete: false, detail: { inDeleteCount: 0, outDeleteCount: 0, inPoolSize: 0, outPoolSize: 0 } },
      }
      const result = await applyDiff({
        wsId: 'stratex', peerId: 'p1', diff,
        selective: [{ path: 'memories/yes.md' }],
        actorUserId: 'phil',
        fetchRemoteContent: async (path) => path === 'memories/yes.md' ? 'y' : 'should-not-be-fetched',
      })
      expect(result.applied.add).toBe(1)
      expect(result.skipped.find((s) => s.path === 'memories/no.md')?.reason).toBe('not selected')
    })

    it('refuses stale plans (remoteSha256 drifted between diff and apply)', async () => {
      const diff = {
        inItems: [{ kind: 'memory' as const, path: 'memories/x.md', op: 'add' as const, remoteSha256: sha('stale') }],
        outItems: [], conflicts: [],
        warnings: { massInDelete: false, massOutDelete: false, detail: { inDeleteCount: 0, outDeleteCount: 0, inPoolSize: 0, outPoolSize: 0 } },
      }
      const result = await applyDiff({
        wsId: 'stratex', peerId: 'p1', diff,
        selective: [{ path: 'memories/x.md', remoteSha256: sha('different') }],
        actorUserId: 'phil',
        fetchRemoteContent: async () => 'never-fetched',
      })
      expect(result.applied.add).toBe(0)
      expect(result.skipped[0].reason).toMatch(/stale plan/)
    })

    it('hardcoded-deny refuses non-syncable paths even if operator selects them', async () => {
      const diff = {
        inItems: [{ kind: 'memory' as const, path: 'sessions/private.json', op: 'add' as const, remoteSha256: sha('x') }],
        outItems: [], conflicts: [],
        warnings: { massInDelete: false, massOutDelete: false, detail: { inDeleteCount: 0, outDeleteCount: 0, inPoolSize: 0, outPoolSize: 0 } },
      }
      const result = await applyDiff({
        wsId: 'stratex', peerId: 'p1', diff,
        selective: [{ path: 'sessions/private.json' }],
        actorUserId: 'phil',
        fetchRemoteContent: async () => 'x',
      })
      expect(result.applied.add).toBe(0)
      expect(result.skipped[0].reason).toBe('hardcoded-deny')
    })

    it('conflict resolution: local keeps file, baseline updated', async () => {
      seedLocalMemory('clash.md', 'local-version')
      const diff = {
        inItems: [], outItems: [],
        conflicts: [{ kind: 'memory' as const, path: 'memories/clash.md', localSha256: sha('local-version'), remoteSha256: sha('remote-version') }],
        warnings: { massInDelete: false, massOutDelete: false, detail: { inDeleteCount: 0, outDeleteCount: 0, inPoolSize: 0, outPoolSize: 0 } },
      }
      const result = await applyDiff({
        wsId: 'stratex', peerId: 'p1', diff,
        selective: [{ path: 'memories/clash.md', resolve: 'local' }],
        actorUserId: 'phil',
        fetchRemoteContent: async () => { throw new Error('should not be called') },
      })
      expect(result.conflictsResolved).toBe(1)
      const baseline = readBaseline('stratex', 'p1')
      expect(baseline.paths['memories/clash.md']).toBe(sha('local-version'))
    })

    it('conflict resolution: remote overwrites local, baseline reflects remote', async () => {
      seedLocalMemory('clash.md', 'local-version')
      const diff = {
        inItems: [], outItems: [],
        conflicts: [{ kind: 'memory' as const, path: 'memories/clash.md', localSha256: sha('local-version'), remoteSha256: sha('remote-version') }],
        warnings: { massInDelete: false, massOutDelete: false, detail: { inDeleteCount: 0, outDeleteCount: 0, inPoolSize: 0, outPoolSize: 0 } },
      }
      const result = await applyDiff({
        wsId: 'stratex', peerId: 'p1', diff,
        selective: [{ path: 'memories/clash.md', resolve: 'remote' }],
        actorUserId: 'phil',
        fetchRemoteContent: async () => 'remote-version',
      })
      expect(result.conflictsResolved).toBe(1)
      const target = join(dataDir, 'workspaces', 'stratex', 'memories', 'clash.md')
      expect(readFileSync(target, 'utf8')).toBe('remote-version')
      const baseline = readBaseline('stratex', 'p1')
      expect(baseline.paths['memories/clash.md']).toBe(sha('remote-version'))
    })

    it('unresolved conflict is skipped', async () => {
      const diff = {
        inItems: [], outItems: [],
        conflicts: [{ kind: 'memory' as const, path: 'memories/clash.md', localSha256: 'a', remoteSha256: 'b' }],
        warnings: { massInDelete: false, massOutDelete: false, detail: { inDeleteCount: 0, outDeleteCount: 0, inPoolSize: 0, outPoolSize: 0 } },
      }
      const result = await applyDiff({
        wsId: 'stratex', peerId: 'p1', diff,
        selective: [{ path: 'memories/clash.md' }], // no resolve
        actorUserId: 'phil',
        fetchRemoteContent: async () => '',
      })
      expect(result.conflictsResolved).toBe(0)
      expect(result.skipped[0].reason).toBe('unresolved conflict')
    })
  })

  describe('Hardcoded-deny matrix (Plan B.5)', () => {
    it('memories/*.md → permitted', () => {
      expect(_internal.isPathPermittedForApply('memories/note.md')).toBe(true)
      expect(_internal.isPathPermittedForApply('memories/sub/deep.md')).toBe(true)
    })
    it('skills/<x>/SKILL.md → permitted', () => {
      expect(_internal.isPathPermittedForApply('skills/r/SKILL.md')).toBe(true)
    })
    it('sessions/shared/<id>.json → permitted', () => {
      expect(_internal.isPathPermittedForApply('sessions/shared/abc.json')).toBe(true)
    })
    it('sessions/<userId>/* → REFUSED (user-private)', () => {
      expect(_internal.isPathPermittedForApply('sessions/phil/abc.json')).toBe(false)
      expect(_internal.isPathPermittedForApply('sessions/private.json')).toBe(false)
    })
    it('members.json, peers.json, meta.json → REFUSED', () => {
      expect(_internal.isPathPermittedForApply('members.json')).toBe(false)
      expect(_internal.isPathPermittedForApply('federation/peers.json')).toBe(false)
      expect(_internal.isPathPermittedForApply('meta.json')).toBe(false)
    })
    it('worker-profiles/* → REFUSED', () => {
      expect(_internal.isPathPermittedForApply('worker-profiles/swarm1/config.yaml')).toBe(false)
    })
    it('any non-listed file → REFUSED (default-deny)', () => {
      expect(_internal.isPathPermittedForApply('random.txt')).toBe(false)
      expect(_internal.isPathPermittedForApply('.env')).toBe(false)
    })
  })

  it('threshold constants match Plan B.5', () => {
    expect(MASS_DELETE_COUNT_THRESHOLD).toBe(50)
    expect(MASS_DELETE_PERCENT_THRESHOLD).toBe(0.3)
  })
})
