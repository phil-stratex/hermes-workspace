import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { detectLegacySource } from './migration-detector'
import {
  ACTIVITY_WINDOW_DAYS,
  SESSION_COUNT_THRESHOLD,
  UA_DIVERSITY_THRESHOLD,
  analyzeMultiPerson,
  isMultiPersonConfirmed,
  multiPersonMarkerPath,
  readMultiPersonConfirmation,
} from './migration-multi-person'
import {
  executeMigration,
  isBackupConfirmedFresh,
  planMigration,
  readBackupConfirmation,
  rollbackFromManifest,
} from './migration'
import { isMigrationCompleted, isMarkerSelfChecksumValid } from './migration-marker'
import { verifyPassword } from './auth-passwords'

function writeBackupConfirmed(dataDir: string, opts: Partial<{ confirmedAt: string }> = {}): void {
  const path = join(dataDir, 'global', '.backup-confirmed')
  mkdirSync(join(dataDir, 'global'), { recursive: true })
  writeFileSync(path, JSON.stringify({
    confirmedAt: opts.confirmedAt ?? new Date().toISOString(),
    snapshotId: 'borg-test-snapshot-001',
    confirmedBy: 'test',
  }))
}

function writeMultiPersonConfirmed(dataDir: string, migrant: string): void {
  const path = join(dataDir, 'global', '.multi-person-tag-confirmed')
  mkdirSync(join(dataDir, 'global'), { recursive: true })
  writeFileSync(path, JSON.stringify({
    confirmedAt: new Date().toISOString(),
    migrantUserId: migrant,
    confirmedBy: 'test',
  }))
}

function seedLegacy(legacyDir: string): void {
  mkdirSync(join(legacyDir, 'memories'), { recursive: true })
  writeFileSync(join(legacyDir, 'memories', 'note.md'), '# legacy memory')
  mkdirSync(join(legacyDir, 'skills', 'researcher'), { recursive: true })
  writeFileSync(join(legacyDir, 'skills', 'researcher', 'SKILL.md'), '# researcher')
  mkdirSync(join(legacyDir, 'profiles', 'swarm1'), { recursive: true })
  writeFileSync(join(legacyDir, 'profiles', 'swarm1', 'config.yaml'), 'role: builder')
  writeFileSync(
    join(legacyDir, 'session-titles.json'),
    JSON.stringify({ s1: 'Old Chat A', s2: 'Old Chat B' }),
  )
  writeFileSync(
    join(legacyDir, 'workspace-sessions.json'),
    JSON.stringify({ tokens: { 'legacy-token-abc': Date.now() + 999_000_000 } }),
  )
}

describe('migration-detector', () => {
  let legacyDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    legacyDir = mkdtempSync(join(tmpdir(), 'migrate-detector-'))
    process.env.HERMES_LEGACY_DATA_DIR = legacyDir
    delete process.env.HERMES_HOME
    delete process.env.CLAUDE_HOME
  })

  afterEach(() => {
    rmSync(legacyDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
  })

  it('detects all legacy subdirs and files', () => {
    seedLegacy(legacyDir)
    const source = detectLegacySource()
    expect(source.hermesHome).toBe(legacyDir)
    expect(source.legacyDirs.memories).toBe(join(legacyDir, 'memories'))
    expect(source.legacyDirs.skills).toBe(join(legacyDir, 'skills'))
    expect(source.legacyDirs.profiles).toBe(join(legacyDir, 'profiles'))
    expect(source.legacyFiles.sessionTitles).toBe(join(legacyDir, 'session-titles.json'))
    expect(source.legacyFiles.workspaceSessions).toBe(join(legacyDir, 'workspace-sessions.json'))
  })

  it('handles empty legacy root', () => {
    const source = detectLegacySource()
    expect(source.legacyDirs.memories).toBeNull()
    expect(source.legacyFiles.sessionTitles).toBeNull()
  })

  it('falls back from memories/ to memory/', () => {
    rmSync(join(legacyDir, 'memories'), { recursive: true, force: true })
    mkdirSync(join(legacyDir, 'memory'), { recursive: true })
    const source = detectLegacySource()
    expect(source.legacyDirs.memories).toBe(join(legacyDir, 'memory'))
  })

  it('hasLegacyPassword reflects HERMES_PASSWORD', () => {
    process.env.HERMES_PASSWORD = 'sekret'
    expect(detectLegacySource().hasLegacyPassword).toBe(true)
    delete process.env.HERMES_PASSWORD
    expect(detectLegacySource().hasLegacyPassword).toBe(false)
  })
})

describe('migration-multi-person', () => {
  it('not flagged on a quiet stack', () => {
    const a = analyzeMultiPerson([])
    expect(a.flagged).toBe(false)
  })

  it('flags on >SESSION_COUNT_THRESHOLD recent sessions', () => {
    const now = Math.floor(Date.now() / 1000)
    const sessions = Array.from({ length: SESSION_COUNT_THRESHOLD + 1 }, (_, i) => ({
      id: `s${i}`,
      lastActiveSec: now,
      userAgent: 'one-browser',
    }))
    const a = analyzeMultiPerson(sessions)
    expect(a.flagged).toBe(true)
    expect(a.reasons[0]).toMatch(/sessions in last/)
  })

  it('flags on >UA_DIVERSITY_THRESHOLD distinct user-agents', () => {
    const now = Math.floor(Date.now() / 1000)
    const sessions = Array.from({ length: 4 }, (_, i) => ({
      id: `s${i}`,
      lastActiveSec: now,
      userAgent: `browser-${i}`,
    }))
    const a = analyzeMultiPerson(sessions)
    expect(a.flagged).toBe(true)
    expect(a.reasons[0]).toMatch(/user-agents/)
  })

  it('does not flag old activity', () => {
    const longAgo = Math.floor(Date.now() / 1000) - (ACTIVITY_WINDOW_DAYS + 5) * 86400
    const sessions = Array.from({ length: SESSION_COUNT_THRESHOLD * 2 }, (_, i) => ({
      id: `s${i}`,
      lastActiveSec: longAgo,
    }))
    const a = analyzeMultiPerson(sessions)
    expect(a.flagged).toBe(false)
  })
})

describe('migration — pre-flight gates', () => {
  let dataDir: string
  let legacyDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'migrate-data-'))
    legacyDir = mkdtempSync(join(tmpdir(), 'migrate-legacy-'))
    process.env.HERMES_DATA_DIR = dataDir
    process.env.HERMES_LEGACY_DATA_DIR = legacyDir
    process.env.HERMES_PASSWORD = 'legacy-secret'
    process.env.HERMES_BCRYPT_COST = '10'
    delete process.env.HERMES_HOME
    delete process.env.CLAUDE_HOME
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(legacyDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
  })

  it('refuses without backup confirmation (L1)', async () => {
    seedLegacy(legacyDir)
    expect(isBackupConfirmedFresh()).toBe(false)
    const plan = planMigration({
      ownerUserId: 'phil',
      ownerEmail: 'phil@x.y',
      ownerName: 'Phil',
      workspaceId: 'stratex',
      workspaceName: 'Stratex',
    })
    await expect(executeMigration(plan)).rejects.toThrow(/backup-confirmed/)
  })

  it('refuses with stale (>24h) backup confirmation', async () => {
    seedLegacy(legacyDir)
    writeBackupConfirmed(dataDir, {
      confirmedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
    })
    expect(isBackupConfirmedFresh()).toBe(false)
    const plan = planMigration({
      ownerUserId: 'phil', ownerEmail: 'phil@x.y', ownerName: 'Phil',
      workspaceId: 'stratex', workspaceName: 'Stratex',
    })
    await expect(executeMigration(plan)).rejects.toThrow(/backup-confirmed/)
  })

  it('refuses with malformed backup-confirmed JSON (N6)', async () => {
    seedLegacy(legacyDir)
    mkdirSync(join(dataDir, 'global'), { recursive: true })
    writeFileSync(join(dataDir, 'global', '.backup-confirmed'), '{ corrupt')
    expect(readBackupConfirmation()).toBeNull()
    expect(isBackupConfirmedFresh()).toBe(false)
  })

  it('accepts a fresh backup confirmation', () => {
    writeBackupConfirmed(dataDir)
    expect(isBackupConfirmedFresh()).toBe(true)
    expect(readBackupConfirmation()?.snapshotId).toBe('borg-test-snapshot-001')
  })

  it('refuses when multi-person flagged without confirmation (L2)', async () => {
    seedLegacy(legacyDir)
    writeBackupConfirmed(dataDir)
    const plan = planMigration({
      ownerUserId: 'phil', ownerEmail: 'phil@x.y', ownerName: 'Phil',
      workspaceId: 'stratex', workspaceName: 'Stratex',
    })
    const now = Math.floor(Date.now() / 1000)
    const flaggedSessions = Array.from({ length: SESSION_COUNT_THRESHOLD + 1 }, (_, i) => ({
      id: `s${i}`,
      lastActiveSec: now,
      userAgent: `ua-${i % 2}`,
    }))
    await expect(
      executeMigration(plan, { legacySessions: flaggedSessions }),
    ).rejects.toThrow(/multi-person/)
  })

  it('proceeds when multi-person confirmed', async () => {
    seedLegacy(legacyDir)
    writeBackupConfirmed(dataDir)
    writeMultiPersonConfirmed(dataDir, 'phil')
    expect(isMultiPersonConfirmed('phil')).toBe(true)
    const plan = planMigration({
      ownerUserId: 'phil', ownerEmail: 'phil@x.y', ownerName: 'Phil',
      workspaceId: 'stratex', workspaceName: 'Stratex',
    })
    const now = Math.floor(Date.now() / 1000)
    const flaggedSessions = Array.from({ length: SESSION_COUNT_THRESHOLD + 1 }, (_, i) => ({
      id: `s${i}`, lastActiveSec: now, userAgent: `ua-${i % 4}`,
    }))
    const result = await executeMigration(plan, { legacySessions: flaggedSessions })
    expect(result.manifest.taggedSessions.length).toBe(flaggedSessions.length)
    // Confirmation marker is one-shot — consumed
    expect(readMultiPersonConfirmation()).toBeNull()
    void multiPersonMarkerPath
  }, 30000)
})

describe('migration — happy path (in-place)', () => {
  let dataDir: string
  let legacyDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'migrate-data-'))
    legacyDir = mkdtempSync(join(tmpdir(), 'migrate-legacy-'))
    process.env.HERMES_DATA_DIR = dataDir
    process.env.HERMES_LEGACY_DATA_DIR = legacyDir
    process.env.HERMES_PASSWORD = 'legacy-secret'
    process.env.HERMES_BCRYPT_COST = '10'
    process.env.HERMES_MIGRATE_IN_PLACE = '1'
    delete process.env.HERMES_HOME
    delete process.env.CLAUDE_HOME
    seedLegacy(legacyDir)
    writeBackupConfirmed(dataDir)
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(legacyDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
  })

  it('plans the migration with all detected moves', () => {
    const plan = planMigration({
      ownerUserId: 'phil', ownerEmail: 'phil@x.y', ownerName: 'Phil',
      workspaceId: 'stratex', workspaceName: 'Stratex',
    })
    const moveTypes = plan.moves.map((m) => m.note)
    expect(moveTypes).toContain('workspace memories (markdown)')
    expect(moveTypes).toContain('workspace skills')
    expect(moveTypes).toContain('worker profiles')
    expect(plan.mode).toBe('in-place')
  })

  it('executes migration: copies memories, creates owner+workspace, tags sessions, marker valid', async () => {
    const plan = planMigration({
      ownerUserId: 'phil', ownerEmail: 'phil@stratex-ai.com', ownerName: 'Phil',
      workspaceId: 'stratex', workspaceName: 'Stratex',
    })
    const sessions = [
      { id: 's1', lastActiveSec: Math.floor(Date.now() / 1000), startedAtSec: Math.floor(Date.now() / 1000) - 100 },
      { id: 's2', lastActiveSec: Math.floor(Date.now() / 1000) - 5 },
    ]
    const result = await executeMigration(plan, { legacySessions: sessions })

    // Memories copied to workspace dir
    const noteDest = join(dataDir, 'workspaces', 'stratex', 'memories', 'note.md')
    expect(existsSync(noteDest)).toBe(true)
    expect(readFileSync(noteDest, 'utf8')).toBe('# legacy memory')

    // Skills copied
    expect(existsSync(join(dataDir, 'workspaces', 'stratex', 'skills', 'researcher', 'SKILL.md'))).toBe(true)
    // Profiles copied to worker-profiles/
    expect(existsSync(join(dataDir, 'workspaces', 'stratex', 'worker-profiles', 'swarm1', 'config.yaml'))).toBe(true)

    // Owner profile + bcrypt hash
    const profile = JSON.parse(readFileSync(join(dataDir, 'users', 'phil', 'profile.json'), 'utf8'))
    expect(profile.id).toBe('phil')
    expect(profile.email).toBe('phil@stratex-ai.com')
    expect(profile.defaultWorkspaceId).toBe('stratex')
    expect(profile.status).toBe('active')
    const hash = readFileSync(join(dataDir, 'users', 'phil', 'auth', 'password-hash.txt'), 'utf8').trim()
    expect(hash).toMatch(/^\$2[aby]\$10\$/)
    expect(await verifyPassword('legacy-secret', hash)).toBe(true)

    // Workspace meta + members
    const meta = JSON.parse(readFileSync(join(dataDir, 'workspaces', 'stratex', 'meta.json'), 'utf8'))
    expect(meta.id).toBe('stratex')
    expect(meta.name).toBe('Stratex')
    expect(meta.createdBy).toBe('phil')
    const members = JSON.parse(readFileSync(join(dataDir, 'workspaces', 'stratex', 'members.json'), 'utf8'))
    expect(members.members).toHaveLength(1)
    expect(members.members[0].role).toBe('owner')

    // Sessions tagged + titles merged
    const sm = JSON.parse(readFileSync(join(dataDir, 'workspaces', 'stratex', 'sessions-meta.json'), 'utf8'))
    expect(sm.sessions.s1.ownerId).toBe('phil')
    expect(sm.sessions.s1.shared).toBe(false)
    expect(sm.sessions.s1.title).toBe('Old Chat A')
    expect(sm.sessions.s2.title).toBe('Old Chat B')

    // Manifest written
    expect(existsSync(result.manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'))
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.taggedSessions).toHaveLength(2)
    expect(manifest.rollbackInstructions.mode).toBe('in-place')
    expect(manifest.rollbackInstructions.inPlaceRollback?.reverseMoves.length ?? 0).toBeGreaterThan(0)

    // Marker valid (D3 / L4)
    expect(isMarkerSelfChecksumValid()).toBe(true)
    expect(isMigrationCompleted()).toBe(true)

    // Legacy workspace-sessions cleared
    const cleared = JSON.parse(readFileSync(join(legacyDir, 'workspace-sessions.json'), 'utf8'))
    expect(cleared.tokens).toEqual({})
  }, 30000)

  it('rejects invalid slug at plan time', () => {
    expect(() => planMigration({
      ownerUserId: '../escape', ownerEmail: 'p@x.y', ownerName: 'P',
      workspaceId: 'stratex', workspaceName: 'Stratex',
    })).toThrow(/invalid ownerUserId/)
    expect(() => planMigration({
      ownerUserId: 'phil', ownerEmail: 'p@x.y', ownerName: 'P',
      workspaceId: '../escape', workspaceName: 'Stratex',
    })).toThrow(/invalid workspaceId/)
  })

  it('idempotency check: marker invalidates re-running', async () => {
    const plan = planMigration({
      ownerUserId: 'phil', ownerEmail: 'p@x.y', ownerName: 'Phil',
      workspaceId: 'stratex', workspaceName: 'Stratex',
    })
    await executeMigration(plan, { legacySessions: [] })
    expect(isMigrationCompleted()).toBe(true)
    // Re-running would overwrite; the higher-level CLI is responsible
    // for refusing — the lower-level executeMigration is idempotent.
    await executeMigration(plan, { legacySessions: [] })
    expect(isMigrationCompleted()).toBe(true)
  }, 60000)
})

describe('migration — rollback', () => {
  let dataDir: string
  let legacyDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'migrate-rb-data-'))
    legacyDir = mkdtempSync(join(tmpdir(), 'migrate-rb-legacy-'))
    process.env.HERMES_DATA_DIR = dataDir
    process.env.HERMES_LEGACY_DATA_DIR = legacyDir
    process.env.HERMES_PASSWORD = 'legacy-secret'
    process.env.HERMES_BCRYPT_COST = '10'
    process.env.HERMES_MIGRATE_IN_PLACE = '1'
    delete process.env.HERMES_HOME
    delete process.env.CLAUDE_HOME
    seedLegacy(legacyDir)
    writeBackupConfirmed(dataDir)
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(legacyDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
  })

  it('rollbackFromManifest deletes marker + manifest (in-place)', async () => {
    const plan = planMigration({
      ownerUserId: 'phil', ownerEmail: 'p@x.y', ownerName: 'Phil',
      workspaceId: 'stratex', workspaceName: 'Stratex',
    })
    await executeMigration(plan, { legacySessions: [] })
    expect(isMigrationCompleted()).toBe(true)

    const result = rollbackFromManifest()
    expect(result.mode).toBe('in-place')
    expect(result.cleared.length).toBeGreaterThan(0)
    expect(isMigrationCompleted()).toBe(false)
  }, 30000)

  it('rollbackFromManifest throws when manifest missing', () => {
    expect(() => rollbackFromManifest()).toThrow(/manifest not found/)
  })
})
