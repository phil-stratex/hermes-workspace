import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  getManifestPath,
  getMarkerPath,
  isMarkerSelfChecksumValid,
  isMigrationCompleted,
  writeMarker,
} from './migration-marker'

describe('migration-marker', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'migration-marker-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
  })

  it('writeMarker creates a valid, self-checksummed marker', () => {
    const content = writeMarker({
      completedAt: '2026-05-08T12:00:00.000Z',
      migrationVersion: 1,
    })
    expect(content.schemaVersion).toBe(1)
    expect(content.completedAt).toBe('2026-05-08T12:00:00.000Z')
    expect(typeof content.selfChecksum).toBe('string')
    expect(content.selfChecksum.length).toBe(64) // sha256 hex
    expect(isMarkerSelfChecksumValid()).toBe(true)
  })

  it('isMigrationCompleted returns true when marker is valid', () => {
    expect(isMigrationCompleted()).toBe(false)
    writeMarker()
    expect(isMigrationCompleted()).toBe(true)
  })

  it('isMigrationCompleted returns false on a fresh stack', () => {
    expect(isMigrationCompleted()).toBe(false)
    expect(isMarkerSelfChecksumValid()).toBe(false)
  })

  it('rejects a tampered marker (checksum mismatch)', () => {
    writeMarker({ completedAt: '2026-05-08T12:00:00.000Z' })
    const raw = JSON.parse(readFileSync(getMarkerPath(), 'utf8'))
    raw.completedAt = '1999-01-01T00:00:00.000Z' // tamper without recomputing checksum
    writeFileSync(getMarkerPath(), JSON.stringify(raw))
    expect(isMarkerSelfChecksumValid()).toBe(false)
  })

  it('rejects a marker with a wrong schemaVersion', () => {
    writeMarker()
    const raw = JSON.parse(readFileSync(getMarkerPath(), 'utf8'))
    raw.schemaVersion = 99
    writeFileSync(getMarkerPath(), JSON.stringify(raw))
    expect(isMarkerSelfChecksumValid()).toBe(false)
  })

  it('rejects a corrupt JSON marker (parse failure)', () => {
    const markerPath = getMarkerPath()
    mkdirSync(dirname(markerPath), { recursive: true })
    writeFileSync(markerPath, '{ this is not json')
    expect(isMarkerSelfChecksumValid()).toBe(false)
  })

  // L4 — Manifest-Cross-Check
  it('treats a missing marker + present manifest as completed (L4)', () => {
    mkdirSync(dirname(getManifestPath()), { recursive: true })
    writeFileSync(getManifestPath(), JSON.stringify({ schemaVersion: 1, moves: [] }))
    expect(isMarkerSelfChecksumValid()).toBe(false)
    expect(isMigrationCompleted()).toBe(true)
  })

  it('treats a corrupt marker + present manifest as completed (L4)', () => {
    mkdirSync(dirname(getMarkerPath()), { recursive: true })
    writeFileSync(getMarkerPath(), '{ corrupt')
    writeFileSync(getManifestPath(), JSON.stringify({ schemaVersion: 1, moves: [] }))
    expect(isMigrationCompleted()).toBe(true)
  })

  it('returns false when both marker and manifest are missing', () => {
    expect(isMigrationCompleted()).toBe(false)
  })

  it('checksum is stable across rewrites of the same body', () => {
    const a = writeMarker({
      completedAt: '2026-05-08T12:00:00.000Z',
      manifestPath: '/m.json',
      migrationVersion: 1,
    })
    const b = writeMarker({
      completedAt: '2026-05-08T12:00:00.000Z',
      manifestPath: '/m.json',
      migrationVersion: 1,
    })
    expect(a.selfChecksum).toBe(b.selfChecksum)
  })

  it('checksum changes when any field changes', () => {
    const a = writeMarker({
      completedAt: '2026-05-08T12:00:00.000Z',
      manifestPath: '/m.json',
      migrationVersion: 1,
    })
    const b = writeMarker({
      completedAt: '2026-05-09T12:00:00.000Z',
      manifestPath: '/m.json',
      migrationVersion: 1,
    })
    expect(a.selfChecksum).not.toBe(b.selfChecksum)
  })
})
