import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  getCurrentWorkerImpls,
  packageJsonHash,
  readIssuesReport,
  revalidateAllWorkspaceRosters,
  revalidateIfPackageChanged,
  validateRosterContent,
  validateWorkspaceRoster,
  workspaceSwarmYamlPath,
} from './swarm-yaml-validator'
import {
  _clearWorkspaceCachesForTests,
  addMember,
  createWorkspace,
} from './workspace-store'
import { createUser } from './users-store'

describe('swarm-yaml-validator (L3)', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'swarm-yaml-validator-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
    // Pin the known-Worker-IDs so the test isn't sensitive to repo state
    process.env.HERMES_KNOWN_WORKER_IDS = 'swarm1;swarm2;swarm3;swarm4;swarm5'
    _clearWorkspaceCachesForTests()
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
    _clearWorkspaceCachesForTests()
  })

  describe('getCurrentWorkerImpls', () => {
    it('reads HERMES_KNOWN_WORKER_IDS env override', () => {
      const ids = getCurrentWorkerImpls()
      expect(ids.has('swarm1')).toBe(true)
      expect(ids.has('swarm5')).toBe(true)
      expect(ids.has('does-not-exist')).toBe(false)
    })
  })

  describe('validateRosterContent', () => {
    const knownIds = new Set(['swarm1', 'swarm2', 'swarm3'])

    it('accepts a valid roster', () => {
      const yaml = `workers:
  - id: swarm1
    role: planner
  - id: swarm2
    role: builder`
      const result = validateRosterContent(yaml, knownIds)
      expect(result.ok).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('flags unknown worker-id', () => {
      const yaml = `workers:
  - id: swarm1
  - id: unknown-worker`
      const result = validateRosterContent(yaml, knownIds)
      expect(result.ok).toBe(false)
      expect(result.errors[0]).toMatch(/unknown worker-id: unknown-worker/)
    })

    it('flags duplicate ids', () => {
      const yaml = `workers:
  - id: swarm1
  - id: swarm1`
      const result = validateRosterContent(yaml, knownIds)
      expect(result.ok).toBe(false)
      expect(result.errors.some((e) => e.includes('duplicated'))).toBe(true)
    })

    it('flags missing id', () => {
      const yaml = `workers:
  - role: orphan`
      const result = validateRosterContent(yaml, knownIds)
      expect(result.ok).toBe(false)
      expect(result.errors[0]).toMatch(/id missing/)
    })

    it('flags missing workers[]', () => {
      const result = validateRosterContent('not-a-list: true', knownIds)
      expect(result.ok).toBe(false)
      expect(result.errors[0]).toMatch(/workers\[\] missing/)
    })

    it('flags malformed YAML', () => {
      const result = validateRosterContent('  - not yaml [', knownIds)
      expect(result.ok).toBe(false)
      expect(result.errors[0]).toMatch(/yaml parse error|workers\[\] missing/)
    })
  })

  describe('validateWorkspaceRoster', () => {
    beforeEach(async () => {
      await createUser({ id: 'phil', email: 'p@x.y', name: 'Phil' })
      await createWorkspace({ id: 'stratex', name: 'Stratex', createdBy: 'phil' })
      await addMember({ wsId: 'stratex', userId: 'phil', role: 'owner', addedBy: 'phil' })
    })

    it('returns ok=true when no Custom roster file (Default fallback)', () => {
      const result = validateWorkspaceRoster('stratex')
      expect(result.ok).toBe(true)
    })

    it('flags issues in a Custom roster file', () => {
      const path = workspaceSwarmYamlPath('stratex')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `workers:\n  - id: ghost-worker\n`)
      const result = validateWorkspaceRoster('stratex')
      expect(result.ok).toBe(false)
      expect(result.errors[0]).toMatch(/unknown worker-id: ghost-worker/)
    })

    it('rejects invalid wsId without crashing', () => {
      const result = validateWorkspaceRoster('../escape')
      expect(result.ok).toBe(false)
      expect(result.errors[0]).toMatch(/invalid wsId/)
    })
  })

  describe('revalidateAllWorkspaceRosters — Boot-time hook', () => {
    beforeEach(async () => {
      await createUser({ id: 'phil', email: 'p@x.y', name: 'Phil' })
      await createWorkspace({ id: 'stratex', name: 'Stratex', createdBy: 'phil' })
      await addMember({ wsId: 'stratex', userId: 'phil', role: 'owner', addedBy: 'phil' })
      await createWorkspace({ id: 'planb', name: 'Plan B', createdBy: 'phil' })
      await addMember({ wsId: 'planb', userId: 'phil', role: 'owner', addedBy: 'phil' })
    })

    it('writes a clean issues file when all rosters are Default', async () => {
      const report = await revalidateAllWorkspaceRosters()
      expect(report.issues).toEqual([])
      expect(report.scannedAt).toBeDefined()
      expect(readIssuesReport()?.issues).toEqual([])
    })

    it('captures issues for Custom rosters with unknown ids', async () => {
      const stratexPath = workspaceSwarmYamlPath('stratex')
      mkdirSync(dirname(stratexPath), { recursive: true })
      writeFileSync(stratexPath, `workers:\n  - id: deprecated-worker\n`)
      const report = await revalidateAllWorkspaceRosters()
      expect(report.issues).toHaveLength(1)
      expect(report.issues[0].wsId).toBe('stratex')
      expect(report.issues[0].errors[0]).toMatch(/unknown worker-id: deprecated-worker/)
    })
  })

  describe('revalidateIfPackageChanged', () => {
    beforeEach(async () => {
      await createUser({ id: 'phil', email: 'p@x.y', name: 'Phil' })
      await createWorkspace({ id: 'stratex', name: 'Stratex', createdBy: 'phil' })
      await addMember({ wsId: 'stratex', userId: 'phil', role: 'owner', addedBy: 'phil' })
    })

    it('first run scans (no previous report)', async () => {
      const report = await revalidateIfPackageChanged()
      expect(report).not.toBeNull()
    })

    it('second run with same package.json is a no-op', async () => {
      await revalidateAllWorkspaceRosters()
      const second = await revalidateIfPackageChanged()
      expect(second).toBeNull()
    })
  })

  describe('packageJsonHash', () => {
    it('returns a stable hex string', () => {
      const a = packageJsonHash()
      const b = packageJsonHash()
      expect(a).toBe(b)
      expect(typeof a).toBe('string')
    })
  })
})
