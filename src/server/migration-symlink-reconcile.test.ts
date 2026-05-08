import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { reconcileLegacySymlinks } from './migration-symlink-reconcile'
import {
  _clearWorkspaceCachesForTests,
  addMember,
  createWorkspace,
} from './workspace-store'
import { createUser } from './users-store'

describe('migration-symlink-reconcile (N1)', () => {
  let dataDir: string
  let legacyRoot: string
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'symlink-reconcile-data-'))
    legacyRoot = mkdtempSync(join(tmpdir(), 'symlink-reconcile-legacy-'))
    process.env.HERMES_DATA_DIR = dataDir
    process.env.HERMES_LEGACY_SWARM_MEMORY_ROOT = legacyRoot
    delete process.env.HERMES_HOME
    _clearWorkspaceCachesForTests()
    await createUser({ id: 'phil', email: 'p@x.y', name: 'Phil' })
    await createWorkspace({ id: 'stratex', name: 'Stratex', createdBy: 'phil' })
    await addMember({ wsId: 'stratex', userId: 'phil', role: 'owner', addedBy: 'phil' })
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(legacyRoot, { recursive: true, force: true })
    process.env = { ...originalEnv }
    _clearWorkspaceCachesForTests()
  })

  it('creates a symlink when legacy exists and target does not', async () => {
    // Seed the legacy dir with a marker file we can verify via the link.
    writeFileSync(join(legacyRoot, 'marker.txt'), 'hello-legacy')

    const result = await reconcileLegacySymlinks()
    const stratex = result.find((r) => r.wsId === 'stratex')
    expect(stratex?.result).toBe('created')

    const target = join(dataDir, 'workspaces', 'stratex', 'memories', 'swarm')
    expect(existsSync(target)).toBe(true)
    // Reading through the symlink/junction should return the seeded
    // content. On Windows we may have created a junction instead of a
    // symlink (no admin rights required); both behave the same to a
    // reader, so we only check the dereferenced content + that the
    // path is NOT a real directory copy.
    expect(readFileSync(join(target, 'marker.txt'), 'utf8')).toBe('hello-legacy')
    const lst = lstatSync(target)
    // Symlink on POSIX, junction on Windows — neither is a regular dir.
    expect(lst.isSymbolicLink() || (process.platform === 'win32' && !lst.isFile())).toBe(true)
  })

  it('idempotent: second run reports already-present', async () => {
    writeFileSync(join(legacyRoot, 'marker.txt'), 'hi')
    await reconcileLegacySymlinks()
    const second = await reconcileLegacySymlinks()
    const stratex = second.find((r) => r.wsId === 'stratex')
    expect(stratex?.result).toBe('already-present')
  })

  it('emits a global audit event on first creation', async () => {
    writeFileSync(join(legacyRoot, 'marker.txt'), 'hi')
    await reconcileLegacySymlinks()
    const day = new Date().toISOString().slice(0, 10)
    const auditPath = join(dataDir, 'global', 'audit', `${day}.jsonl`)
    expect(existsSync(auditPath)).toBe(true)
    const events = readFileSync(auditPath, 'utf8')
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l))
    const event = events.find((e) => e.type === 'legacy_symlink_reconciled')
    expect(event).toBeDefined()
    expect(event.wsId).toBe('stratex')
  })

  it('reports no-legacy when the legacy root is empty', async () => {
    const result = await reconcileLegacySymlinks()
    const stratex = result.find((r) => r.wsId === 'stratex')
    expect(stratex?.result).toBe('no-legacy')
    const target = join(dataDir, 'workspaces', 'stratex', 'memories', 'swarm')
    expect(existsSync(target)).toBe(false)
  })

  it('skips workspaces that already have a real (non-symlink) memories/swarm dir', async () => {
    // Pre-create a real directory in the workspace — reconcile must
    // leave it alone (don't bulldoze WS-data with a symlink to legacy).
    const real = join(dataDir, 'workspaces', 'stratex', 'memories', 'swarm')
    mkdirSync(real, { recursive: true })
    writeFileSync(join(real, 'real.txt'), 'workspace-owned')
    writeFileSync(join(legacyRoot, 'marker.txt'), 'should-not-show-up')

    const result = await reconcileLegacySymlinks()
    const stratex = result.find((r) => r.wsId === 'stratex')
    expect(stratex?.result).toBe('already-present')

    // Verify the workspace's content is intact.
    expect(readFileSync(join(real, 'real.txt'), 'utf8')).toBe('workspace-owned')
    expect(existsSync(join(real, 'marker.txt'))).toBe(false)
  })

  it('iterates only active workspaces', async () => {
    await createWorkspace({ id: 'planb', name: 'Plan B', createdBy: 'phil' })
    await addMember({ wsId: 'planb', userId: 'phil', role: 'owner', addedBy: 'phil' })
    writeFileSync(join(legacyRoot, 'marker.txt'), 'hi')
    const result = await reconcileLegacySymlinks()
    expect(result.map((r) => r.wsId).sort()).toEqual(['planb', 'stratex'])
  })
})
