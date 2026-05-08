import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _mutexChainsSizeForTests,
  withMutex,
  writeJsonAtomic,
  writeTextAtomic,
} from './atomic-write'

describe('writeTextAtomic', () => {
  it('writes target file and leaves no temp artefacts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-write-'))
    try {
      const target = join(dir, 'hello.txt')
      writeTextAtomic(target, 'world')
      expect(readFileSync(target, 'utf8')).toBe('world')
      const leftovers = readdirSync(dir).filter((n) => n !== 'hello.txt')
      expect(leftovers).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('overwrites existing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-write-'))
    try {
      const target = join(dir, 'hello.txt')
      writeFileSync(target, 'old', 'utf8')
      writeTextAtomic(target, 'new')
      expect(readFileSync(target, 'utf8')).toBe('new')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('writeJsonAtomic', () => {
  it('produces valid JSON under high concurrency', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-write-'))
    try {
      const target = join(dir, 'data.json')
      writeJsonAtomic(target, { initial: true })
      const tasks = Array.from({ length: 200 }, (_, i) =>
        Promise.resolve().then(() => writeJsonAtomic(target, { i })),
      )
      await Promise.all(tasks)
      // Final file must parse cleanly — torn JSON would throw here.
      const parsed = JSON.parse(readFileSync(target, 'utf8'))
      expect(typeof parsed).toBe('object')
      const leftovers = readdirSync(dir).filter((n) => n !== 'data.json')
      expect(leftovers).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('withMutex', () => {
  it('serialises async functions sharing a key', async () => {
    const order: Array<string> = []
    const work = (label: string, ms: number) =>
      withMutex('k', async () => {
        order.push(`${label}-start`)
        await new Promise((r) => setTimeout(r, ms))
        order.push(`${label}-end`)
      })
    await Promise.all([work('a', 30), work('b', 5), work('c', 10)])
    expect(order).toEqual([
      'a-start',
      'a-end',
      'b-start',
      'b-end',
      'c-start',
      'c-end',
    ])
  })

  it('keeps the chain alive when a task throws', async () => {
    let reached = false
    await withMutex('throws', async () => {
      throw new Error('boom')
    }).catch(() => null)
    await withMutex('throws', async () => {
      reached = true
    })
    expect(reached).toBe(true)
  })

  it('returns the function result', async () => {
    const result = await withMutex('ret', async () => 42)
    expect(result).toBe(42)
  })

  // N7 — Self-cleanup-finally: unique keys must not leak slots in the
  // internal map. Without the finally hook, a chain like
  // `snapshot:${wsId}:${sid}` keyed on thousands of unique session IDs
  // would grow the map monotonically.
  it('drops the chain slot after settle (no unbounded growth)', async () => {
    const sizeBefore = _mutexChainsSizeForTests()
    const tasks = Array.from({ length: 1000 }, (_, i) =>
      withMutex(`unique-${i}`, async () => i * 2),
    )
    const results = await Promise.all(tasks)
    expect(results).toEqual(Array.from({ length: 1000 }, (_, i) => i * 2))
    // Drain microtasks so the .finally() handlers have all fired.
    await new Promise((resolve) => setImmediate(resolve))
    const sizeAfter = _mutexChainsSizeForTests()
    expect(sizeAfter).toBe(sizeBefore)
  })

  it('cleanup is race-safe — newer call on the same key keeps its slot', async () => {
    const key = 'race-safe-key'
    let firstResolve: (() => void) | null = null
    const firstStarted = new Promise<void>((started) => {
      void withMutex(key, async () => {
        started()
        await new Promise<void>((resolve) => {
          firstResolve = resolve
        })
      })
    })
    await firstStarted
    // Second call queues behind the first — slot belongs to the queued chain.
    const secondPromise = withMutex(key, async () => 'second')
    // Resolve first; cleanup-finally for the first chain MUST NOT delete
    // the slot, because the second chain has already overwritten it.
    firstResolve!()
    await secondPromise
    // After both settle, the slot is cleared by the second chain's finally.
    await new Promise((resolve) => setImmediate(resolve))
    expect(_mutexChainsSizeForTests()).toBe(0)
  })
})
