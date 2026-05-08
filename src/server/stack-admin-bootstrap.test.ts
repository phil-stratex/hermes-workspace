import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('./auth-middleware', () => ({
  isMultiTenantAuthEnabled: vi.fn(),
}))

import { isMultiTenantAuthEnabled } from './auth-middleware'
import {
  _clearGlobalSettingsCacheForTests,
  addStackAdmin,
  getStackAdmins,
} from './global-settings'
import {
  _clearWorkspaceCachesForTests,
  addMember,
  createWorkspace,
} from './workspace-store'
import { bootstrapStackAdminsIfNeeded } from './stack-admin-bootstrap'

// Helper alias — vi.mocked auto-types based on the input function's signature.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function m<T extends (...args: Array<any>) => any>(fn: T): ReturnType<typeof vi.mocked<T>> {
  return vi.mocked(fn)
}

describe('stack-admin-bootstrap', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'stack-admin-bootstrap-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
    _clearGlobalSettingsCacheForTests()
    _clearWorkspaceCachesForTests()
    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
    _clearGlobalSettingsCacheForTests()
    _clearWorkspaceCachesForTests()
  })

  it('skips in legacy mode (isMultiTenantAuthEnabled=false)', async () => {
    m(isMultiTenantAuthEnabled).mockReturnValue(false)
    const r = await bootstrapStackAdminsIfNeeded()
    expect(r).toEqual({ action: 'skipped', reason: 'legacy-mode' })
    expect(getStackAdmins()).toEqual([])
  })

  it('skips when stackAdmins already populated', async () => {
    m(isMultiTenantAuthEnabled).mockReturnValue(true)
    await addStackAdmin('phil', 'system', 'cli')
    const r = await bootstrapStackAdminsIfNeeded()
    expect(r).toEqual({ action: 'skipped', reason: 'already-populated' })
    expect(getStackAdmins()).toHaveLength(1)
  })

  it('skips when no workspaces exist', async () => {
    m(isMultiTenantAuthEnabled).mockReturnValue(true)
    const r = await bootstrapStackAdminsIfNeeded()
    expect(r).toEqual({ action: 'skipped', reason: 'no-owner-found' })
  })

  it('promotes the oldest owner across all workspaces', async () => {
    m(isMultiTenantAuthEnabled).mockReturnValue(true)
    // Workspace A — owner alice (joined first)
    await createWorkspace({ id: 'a', name: 'A', createdBy: 'alice' })
    await addMember({ wsId: 'a', userId: 'alice', role: 'owner', addedBy: 'alice' })
    // Force the join-times far apart for a deterministic sort
    await new Promise((r) => setTimeout(r, 20))
    // Workspace B — owner bob (joined second)
    await createWorkspace({ id: 'b', name: 'B', createdBy: 'bob' })
    await addMember({ wsId: 'b', userId: 'bob', role: 'owner', addedBy: 'bob' })

    const r = await bootstrapStackAdminsIfNeeded()
    expect(r.action).toBe('promoted')
    if (r.action === 'promoted') {
      expect(r.userId).toBe('alice')
      expect(r.sourceWorkspaceId).toBe('a')
    }
    expect(getStackAdmins()).toHaveLength(1)
    expect(getStackAdmins()[0].userId).toBe('alice')
    expect(getStackAdmins()[0].addedVia).toBe('bootstrap')
    expect(getStackAdmins()[0].addedBy).toBe('system')
  })

  it('idempotent — second run is a no-op', async () => {
    m(isMultiTenantAuthEnabled).mockReturnValue(true)
    await createWorkspace({ id: 'a', name: 'A', createdBy: 'alice' })
    await addMember({ wsId: 'a', userId: 'alice', role: 'owner', addedBy: 'alice' })

    const first = await bootstrapStackAdminsIfNeeded()
    expect(first.action).toBe('promoted')
    const second = await bootstrapStackAdminsIfNeeded()
    expect(second).toEqual({ action: 'skipped', reason: 'already-populated' })
    expect(getStackAdmins()).toHaveLength(1)
  })
})
