import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { assertCoherentBootState, describeBootState } from './boot-state-check'
import { writeMarker } from './migration-marker'
import { createUser } from './users-store'

describe('boot-state-check (F1)', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'boot-state-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
  })

  it('fresh-stack: no users, no marker, no manifest', () => {
    const r = describeBootState()
    expect(r.state).toBe('fresh-stack')
    expect(r.usersExist).toBe(false)
    expect(r.markerValid).toBe(false)
    expect(r.manifestExists).toBe(false)
    expect(() => assertCoherentBootState()).not.toThrow()
  })

  it('normal: users exist + valid marker', async () => {
    await createUser({ id: 'phil', email: 'phil@stratex-ai.com', name: 'Phil' })
    writeMarker()
    const r = describeBootState()
    expect(r.state).toBe('normal')
    expect(() => assertCoherentBootState()).not.toThrow()
  })

  it('recovery-via-manifest: users exist + manifest only (L4 cross-check)', async () => {
    await createUser({ id: 'phil', email: 'phil@stratex-ai.com', name: 'Phil' })
    const manifestPath = join(dataDir, 'global', 'migration-manifest.json')
    mkdirSync(dirname(manifestPath), { recursive: true })
    writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, moves: [] }))
    const r = describeBootState()
    expect(r.state).toBe('recovery-via-manifest')
    expect(() => assertCoherentBootState()).not.toThrow()
  })

  it('inconsistent: users exist but no marker, no manifest → THROWS', async () => {
    await createUser({ id: 'phil', email: 'phil@stratex-ai.com', name: 'Phil' })
    const r = describeBootState()
    expect(r.state).toBe('inconsistent')
    expect(() => assertCoherentBootState()).toThrow(/incoherent stack state/)
    expect(() => assertCoherentBootState()).toThrow(/repair-marker/)
  })

  it('inconsistent: users exist with corrupt marker, no manifest → THROWS', async () => {
    await createUser({ id: 'phil', email: 'phil@stratex-ai.com', name: 'Phil' })
    // Write a corrupt marker (will fail self-checksum)
    const markerPath = join(dataDir, 'global', 'migration-completed.json')
    mkdirSync(dirname(markerPath), { recursive: true })
    writeFileSync(markerPath, '{ "schemaVersion": 1, "selfChecksum": "wrong" }')
    const r = describeBootState()
    expect(r.state).toBe('inconsistent')
    expect(() => assertCoherentBootState()).toThrow()
  })
})
