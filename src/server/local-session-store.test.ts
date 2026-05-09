/**
 * Coverage for local-session-store — Stratex's portable on-disk
 * session cache (Ollama / Atomic Chat use-case).
 *
 * The module persists to `<cwd>/.runtime/local-sessions.json` via
 * `writeJsonAtomic`, so isolation here is achieved by:
 *  - mkdtempSync for a fresh tmpdir per test,
 *  - process.chdir(tmpdir) BEFORE the dynamic-import (the module
 *    captures DATA_DIR from process.cwd() at module-load),
 *  - vi.resetModules() between tests so the module-level `store`,
 *    `saveTimer` etc. start clean.
 *
 * Debounce verification uses vi.useFakeTimers() — never real wall-clock
 * waits.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Store = typeof import('./local-session-store')

const originalCwd = process.cwd()
let dataDir: string

async function loadFreshStore(): Promise<Store> {
  vi.resetModules()
  return await import('./local-session-store')
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'local-session-store-'))
  process.chdir(dataDir)
})

afterEach(() => {
  // Always clear timers first — a pending scheduleSave() with fake
  // timers would otherwise fire into the next test's tmpdir.
  vi.useRealTimers()
  process.chdir(originalCwd)
  rmSync(dataDir, { recursive: true, force: true })
})

function sessionsFilePath(): string {
  return join(dataDir, '.runtime', 'local-sessions.json')
}

function readDiskStore(): {
  sessions: Record<string, unknown>
  messages: Record<string, Array<unknown>>
} {
  return JSON.parse(readFileSync(sessionsFilePath(), 'utf8'))
}

describe('ensureLocalSession', () => {
  it('creates a session lazily and is idempotent on second call', async () => {
    const mod = await loadFreshStore()
    const first = mod.ensureLocalSession('s1', 'kimi-k2.6')
    const second = mod.ensureLocalSession('s1', 'something-else')
    // Same identity — second call must not overwrite.
    expect(second).toBe(first)
    expect(second.id).toBe('s1')
    expect(second.model).toBe('kimi-k2.6')
    expect(second.title).toBeNull()
    expect(second.messageCount).toBe(0)
    // Persisted to disk synchronously (ensure is not debounced).
    expect(existsSync(sessionsFilePath())).toBe(true)
    const disk = readDiskStore()
    expect(Object.keys(disk.sessions)).toEqual(['s1'])
  })

  it('defaults model to null when omitted', async () => {
    const mod = await loadFreshStore()
    const session = mod.ensureLocalSession('no-model')
    expect(session.model).toBeNull()
  })
})

describe('updateLocalSessionTitle', () => {
  it('persists synchronously — readable from disk without timer advance', async () => {
    const mod = await loadFreshStore()
    mod.ensureLocalSession('s2')
    mod.updateLocalSessionTitle('s2', 'Hello world')
    // No timer wait, no debounce — disk MUST already reflect the title.
    const disk = readDiskStore()
    expect((disk.sessions.s2 as { title: string }).title).toBe('Hello world')
  })

  it('is a no-op for unknown session ids', async () => {
    const mod = await loadFreshStore()
    expect(() => mod.updateLocalSessionTitle('ghost', 'X')).not.toThrow()
    // No session was created → file was never written.
    expect(existsSync(sessionsFilePath())).toBe(false)
  })
})

describe('appendLocalMessage / scheduleSave debounce', () => {
  it('does not flush to disk before 2s, but does after 2s+', async () => {
    vi.useFakeTimers()
    const mod = await loadFreshStore()
    // ensureLocalSession itself is sync-flush, so it primes the file.
    mod.ensureLocalSession('s3')
    const baselineRaw = readFileSync(sessionsFilePath(), 'utf8')
    const baseline = JSON.parse(baselineRaw) as {
      messages: Record<string, Array<unknown>>
    }
    expect(baseline.messages.s3).toEqual([])

    mod.appendLocalMessage('s3', {
      id: 'm1',
      role: 'user',
      content: 'hello',
      timestamp: 1,
    })
    // Before debounce window expires, the in-memory state has the
    // message but disk still shows the post-ensure baseline.
    vi.advanceTimersByTime(1900)
    {
      const beforeDisk = JSON.parse(readFileSync(sessionsFilePath(), 'utf8')) as {
        messages: Record<string, Array<unknown>>
      }
      expect(beforeDisk.messages.s3).toEqual([])
    }
    // In-memory accessor already shows the message.
    expect(mod.getLocalMessages('s3')).toHaveLength(1)

    // Cross the 2s threshold → debounce timer fires → disk catches up.
    vi.advanceTimersByTime(200)
    const afterDisk = JSON.parse(readFileSync(sessionsFilePath(), 'utf8')) as {
      messages: Record<string, Array<{ id: string }>>
    }
    expect(afterDisk.messages.s3).toHaveLength(1)
    expect(afterDisk.messages.s3[0].id).toBe('m1')
  })

  it('coalesces multiple appends into a single flush per debounce window', async () => {
    vi.useFakeTimers()
    const mod = await loadFreshStore()
    mod.ensureLocalSession('s4')

    for (let i = 0; i < 5; i += 1) {
      mod.appendLocalMessage('s4', {
        id: `m${i}`,
        role: 'user',
        content: `c${i}`,
        timestamp: i,
      })
      // 100ms apart — well within the 2s debounce.
      vi.advanceTimersByTime(100)
    }
    // 500ms total elapsed → still inside window → no flush yet.
    {
      const disk = JSON.parse(readFileSync(sessionsFilePath(), 'utf8')) as {
        messages: Record<string, Array<unknown>>
      }
      expect(disk.messages.s4).toEqual([])
    }
    // The original scheduleSave guard `if (saveTimer) return` means
    // the first append wins — its 2s timer expires at ~2000ms from
    // first append (= 1500ms after the last append). Advance enough.
    vi.advanceTimersByTime(2100)
    const flushed = JSON.parse(readFileSync(sessionsFilePath(), 'utf8')) as {
      messages: Record<string, Array<{ id: string }>>
    }
    expect(flushed.messages.s4).toHaveLength(5)
    expect(flushed.messages.s4.map((m) => m.id)).toEqual([
      'm0',
      'm1',
      'm2',
      'm3',
      'm4',
    ])
  })

  it('30 concurrent appends — all messages persisted, none lost', async () => {
    // Real timers here so we can actually wait for the 2s debounce
    // flush. We DO use vi.advanceTimersByTime in the dedicated debounce
    // tests; here we're stress-testing the in-memory mutation path.
    const mod = await loadFreshStore()
    mod.ensureLocalSession('s5')

    const tasks = Array.from({ length: 30 }, (_, i) =>
      Promise.resolve().then(() =>
        mod.appendLocalMessage('s5', {
          id: `m${i}`,
          role: 'user',
          content: `content-${i}`,
          timestamp: i,
        }),
      ),
    )
    await Promise.all(tasks)

    // In-memory: all 30 are present in append order.
    expect(mod.getLocalMessages('s5')).toHaveLength(30)
    expect(mod.getLocalMessages('s5').map((m) => m.id)).toEqual(
      Array.from({ length: 30 }, (_, i) => `m${i}`),
    )

    // Disk: wait for debounce flush, then verify no torn JSON / lost rows.
    await new Promise((r) => setTimeout(r, 2200))
    const disk = readDiskStore()
    const persisted = (
      disk.messages.s5 as Array<{ id: string }>
    ).map((m) => m.id)
    expect(persisted).toHaveLength(30)
    expect(persisted).toEqual(Array.from({ length: 30 }, (_, i) => `m${i}`))
  })
})

describe('deleteLocalSession', () => {
  it('removes the session and its messages, persisted immediately', async () => {
    const mod = await loadFreshStore()
    mod.ensureLocalSession('to-delete')
    expect(mod.getLocalSession('to-delete')).not.toBeNull()
    mod.deleteLocalSession('to-delete')
    expect(mod.getLocalSession('to-delete')).toBeNull()
    expect(mod.getLocalMessages('to-delete')).toEqual([])
    // Disk reflects the delete sync (no debounce on delete).
    const disk = readDiskStore()
    expect(disk.sessions['to-delete']).toBeUndefined()
    expect(disk.messages['to-delete']).toBeUndefined()
  })
})

describe('getLocalMessages', () => {
  it('returns messages in append order', async () => {
    const mod = await loadFreshStore()
    mod.ensureLocalSession('order')
    const ids = ['a', 'b', 'c', 'd']
    for (const id of ids) {
      mod.appendLocalMessage('order', {
        id,
        role: 'user',
        content: id,
        timestamp: id.charCodeAt(0),
      })
    }
    expect(mod.getLocalMessages('order').map((m) => m.id)).toEqual(ids)
  })

  it('returns empty array for unknown session', async () => {
    const mod = await loadFreshStore()
    expect(mod.getLocalMessages('nope')).toEqual([])
  })
})

describe('listLocalSessions', () => {
  it('returns empty array when no sessions exist', async () => {
    const mod = await loadFreshStore()
    expect(mod.listLocalSessions()).toEqual([])
  })

  it('returns sessions sorted by updatedAt descending after several ensures', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-09T00:00:00Z'))
    const mod = await loadFreshStore()

    mod.ensureLocalSession('first')
    vi.advanceTimersByTime(1000)
    mod.ensureLocalSession('second')
    vi.advanceTimersByTime(1000)
    mod.ensureLocalSession('third')

    const list = mod.listLocalSessions()
    expect(list.map((s) => s.id)).toEqual(['third', 'second', 'first'])
  })
})

describe('touchLocalSession', () => {
  it('updates in-memory updatedAt without writing to disk; next real save persists the bumped ts', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-09T10:00:00Z'))
    const mod = await loadFreshStore()
    mod.ensureLocalSession('touched')

    // Snapshot the on-disk file as-of just-after-ensure.
    const beforeBytes = readFileSync(sessionsFilePath())
    const beforeDisk = JSON.parse(beforeBytes.toString('utf8')) as {
      sessions: Record<string, { updatedAt: number }>
    }
    const initialUpdatedAt = beforeDisk.sessions.touched.updatedAt

    // Advance system time so a touch produces a *different* timestamp.
    vi.advanceTimersByTime(60_000)
    mod.touchLocalSession('touched')

    // Disk file MUST be byte-identical — touchLocalSession does not call
    // saveToDisk (verified by reading raw bytes, not just parsing).
    const afterBytes = readFileSync(sessionsFilePath())
    expect(afterBytes.equals(beforeBytes)).toBe(true)
    const stillOnDisk = JSON.parse(afterBytes.toString('utf8')) as {
      sessions: Record<string, { updatedAt: number }>
    }
    expect(stillOnDisk.sessions.touched.updatedAt).toBe(initialUpdatedAt)

    // In-memory the touch is visible.
    const inMemory = mod.getLocalSession('touched')
    expect(inMemory).not.toBeNull()
    expect(inMemory!.updatedAt).toBeGreaterThan(initialUpdatedAt)
    const touchedTs = inMemory!.updatedAt

    // Trigger a real disk-flush via updateLocalSessionTitle (sync-flush),
    // then verify the bumped updatedAt is now persisted.
    mod.updateLocalSessionTitle('touched', 'after-touch')
    const finalDisk = JSON.parse(
      readFileSync(sessionsFilePath(), 'utf8'),
    ) as {
      sessions: Record<string, { updatedAt: number; title: string }>
    }
    // updateLocalSessionTitle bumps updatedAt to Date.now() again,
    // so the value on disk is at least the touched ts.
    expect(finalDisk.sessions.touched.title).toBe('after-touch')
    expect(finalDisk.sessions.touched.updatedAt).toBeGreaterThanOrEqual(
      touchedTs,
    )
  })

  it('is a no-op for unknown session id', async () => {
    const mod = await loadFreshStore()
    expect(() => mod.touchLocalSession('ghost')).not.toThrow()
    // file may or may not exist — if it doesn't, that's fine.
    if (existsSync(sessionsFilePath())) {
      const disk = readDiskStore()
      expect(disk.sessions.ghost).toBeUndefined()
    }
  })
})
