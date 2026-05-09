import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Source-of-truth split (refactor 2026-05-09):
 *
 * Local-sessions exclusively in `local-session-store.json` (via
 * `updateLocalSessionTitle`). Gateway-sessions exclusively in
 * `session-titles.json` (via `writeSessionTitle`).
 *
 * These tests assert that no code path in `sessions.ts` writes a local-session
 * title into `session-titles.json`, and no code path reads `session-titles.json`
 * back into a local-session row.
 */

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-sessions-titles-'))
const TITLES_FILE = path.join(tmpRoot, 'session-titles.json')

// Mock the local-session-store so tests can spy on updateLocalSessionTitle
// without touching disk.runtime/local-sessions.json (which lives under
// process.cwd() and would pollute the working tree).
const updateLocalSessionTitleSpy = vi.fn<(id: string, title: string) => void>()
const getLocalMessagesSpy = vi.fn<
  (id: string) => Array<{ role: string; content: string }>
>()
const getLocalSessionSpy = vi.fn<
  (id: string) => { id: string; title: string | null; createdAt: number; updatedAt: number; messageCount: number; model: string | null } | null
>()

vi.mock('../../server/local-session-store', () => ({
  updateLocalSessionTitle: (id: string, title: string) =>
    updateLocalSessionTitleSpy(id, title),
  getLocalMessages: (id: string) => getLocalMessagesSpy(id),
  getLocalSession: (id: string) => getLocalSessionSpy(id),
  listLocalSessions: () => [],
  deleteLocalSession: () => undefined,
}))

beforeEach(() => {
  process.env.HERMES_HOME = tmpRoot
  // Start each test with empty stores
  if (fs.existsSync(TITLES_FILE)) fs.rmSync(TITLES_FILE)
  updateLocalSessionTitleSpy.mockReset()
  getLocalMessagesSpy.mockReset()
  getLocalSessionSpy.mockReset()
  vi.resetModules()
})

afterEach(() => {
  delete process.env.HERMES_HOME
})

function readTitles(): Record<string, string> {
  if (!fs.existsSync(TITLES_FILE)) return {}
  return JSON.parse(fs.readFileSync(TITLES_FILE, 'utf-8'))
}

describe('writeSessionTitle (gateway-sessions only)', () => {
  it('writes a gateway-session key into session-titles.json', async () => {
    const mod = await import('./sessions')
    await mod.writeSessionTitle('gw-session-123', 'Gateway Session Title')
    expect(readTitles()).toEqual({ 'gw-session-123': 'Gateway Session Title' })
    // Local-session-store must not be touched.
    expect(updateLocalSessionTitleSpy).not.toHaveBeenCalled()
  })
})

describe('applyStoredTitles (skip local-source rows)', () => {
  it('overlays a stored title onto a gateway-session row', async () => {
    const mod = await import('./sessions')
    await mod.writeSessionTitle('gw-1', 'Stored Gateway Title')

    const out = mod.applyStoredTitles([
      { key: 'gw-1', id: 'gw-1', title: 'Old Title', source: 'gateway' },
    ])

    expect(out[0]).toMatchObject({
      label: 'Stored Gateway Title',
      title: 'Stored Gateway Title',
      derivedTitle: 'Stored Gateway Title',
    })
  })

  it('skips local-source rows even when their key is in session-titles.json', async () => {
    const mod = await import('./sessions')
    // Simulate a stale entry from before the source-of-truth split: a
    // local-session id that ended up in session-titles.json. After the
    // refactor, applyStoredTitles must NOT apply this stale title.
    await mod.writeSessionTitle('local-1', 'Stale Title from old store')

    const out = mod.applyStoredTitles([
      {
        key: 'local-1',
        id: 'local-1',
        title: 'Real Title from local-session-store',
        label: 'Real Title from local-session-store',
        source: 'local',
      },
    ])

    // Local row is returned unchanged — the stale entry is ignored.
    expect(out[0].title).toBe('Real Title from local-session-store')
    expect(out[0].label).toBe('Real Title from local-session-store')
  })

  it('returns input unchanged when titles file is empty', async () => {
    const mod = await import('./sessions')
    const input = [{ key: 'x', id: 'x', source: 'gateway' as const }]
    expect(mod.applyStoredTitles(input)).toEqual(input)
  })
})

describe('withDerivedLocalTitles (writes ONLY to local-session-store)', () => {
  it('derives title from first user message and persists to local-session-store, NOT session-titles.json', async () => {
    getLocalMessagesSpy.mockReturnValue([
      { role: 'user', content: 'Implement a CSV parser in Rust' },
    ])

    const mod = await import('./sessions')
    const out = mod.withDerivedLocalTitles([
      {
        key: 'local-42',
        id: 'local-42',
        title: 'Local Chat',
        label: 'Local Chat',
        source: 'local',
      },
    ])

    // The derived title is reflected in the returned row...
    expect(out[0]).toMatchObject({
      title: 'Implement a CSV parser in Rust',
      label: 'Implement a CSV parser in Rust',
      derivedTitle: 'Implement a CSV parser in Rust',
    })

    // ...persisted via updateLocalSessionTitle (local-session-store)...
    expect(updateLocalSessionTitleSpy).toHaveBeenCalledTimes(1)
    expect(updateLocalSessionTitleSpy).toHaveBeenCalledWith(
      'local-42',
      'Implement a CSV parser in Rust',
    )

    // ...and NOT into session-titles.json.
    expect(readTitles()).toEqual({})
  })

  it('skips non-local sessions entirely (never invokes updateLocalSessionTitle)', async () => {
    const mod = await import('./sessions')
    const out = mod.withDerivedLocalTitles([
      {
        key: 'gw-7',
        id: 'gw-7',
        title: 'Gateway',
        label: 'Gateway',
        source: 'gateway',
      },
    ])

    expect(out[0].title).toBe('Gateway')
    expect(updateLocalSessionTitleSpy).not.toHaveBeenCalled()
    expect(getLocalMessagesSpy).not.toHaveBeenCalled()
  })

  it('returns row unchanged when local-session already has a non-placeholder title', async () => {
    const mod = await import('./sessions')
    const input = [
      {
        key: 'local-already-named',
        id: 'local-already-named',
        title: 'A real title',
        label: 'A real title',
        source: 'local',
      },
    ]
    const out = mod.withDerivedLocalTitles(input)
    expect(out).toEqual(input)
    expect(updateLocalSessionTitleSpy).not.toHaveBeenCalled()
    expect(getLocalMessagesSpy).not.toHaveBeenCalled()
  })

  it('does not derive when there is no user message', async () => {
    getLocalMessagesSpy.mockReturnValue([
      { role: 'assistant', content: 'Hi, how can I help?' },
    ])
    const mod = await import('./sessions')
    const out = mod.withDerivedLocalTitles([
      {
        key: 'local-empty',
        id: 'local-empty',
        title: 'Local Chat',
        label: 'Local Chat',
        source: 'local',
      },
    ])

    // Returned unchanged (no user message → no derivation).
    expect(out[0].title).toBe('Local Chat')
    expect(updateLocalSessionTitleSpy).not.toHaveBeenCalled()
    expect(readTitles()).toEqual({})
  })
})

describe('source-of-truth split — combined chain (applyStoredTitles → withDerivedLocalTitles)', () => {
  it('produces correct titles for both kinds without cross-store contamination', async () => {
    // Setup: gateway-1 has a stored title in session-titles.json,
    // local-1 has a stale entry there too (pretend pre-refactor data).
    const mod = await import('./sessions')
    await mod.writeSessionTitle('gateway-1', 'Real Gateway Title')
    await mod.writeSessionTitle('local-1', 'STALE — must be ignored')

    getLocalMessagesSpy.mockReturnValue([
      { role: 'user', content: 'Hello local world' },
    ])

    const merged = [
      { key: 'gateway-1', id: 'gateway-1', title: 'Old', source: 'gateway' },
      {
        key: 'local-1',
        id: 'local-1',
        title: 'Local Chat',
        label: 'Local Chat',
        source: 'local',
      },
    ]
    const out = mod.withDerivedLocalTitles(mod.applyStoredTitles(merged))

    // Gateway row picked up its stored title.
    expect(out[0].title).toBe('Real Gateway Title')
    // Local row got a derived title — the STALE entry was NOT applied.
    expect(out[1].title).toBe('Hello local world')

    // Local-session-store received the derived title; titles file is
    // untouched for the local-session id (still holds the stale entry,
    // which is harmless because applyStoredTitles skips local rows).
    expect(updateLocalSessionTitleSpy).toHaveBeenCalledWith(
      'local-1',
      'Hello local world',
    )
    expect(readTitles()['gateway-1']).toBe('Real Gateway Title')
    // Stale entry is ignored, not deleted (no migration).
    expect(readTitles()['local-1']).toBe('STALE — must be ignored')
  })
})
