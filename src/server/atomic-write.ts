/**
 * Atomic file writes + in-process serialisation primitives.
 *
 * `writeJsonAtomic` and `writeTextAtomic` write to a temp sibling file and
 * `rename` it over the target. Rename is atomic on POSIX and on NTFS for
 * same-filesystem moves, so a reader during the write either sees the
 * pre-write contents or the post-write contents — never a torn JSON.
 *
 * `withMutex` chains async functions per key so two callers PATCHing the
 * same store can't read-modify-write over each other.
 */

import { renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'

function tempPathFor(target: string): string {
  return join(dirname(target), `.${basename(target)}.tmp.${process.pid}.${randomUUID()}`)
}

export function writeTextAtomic(target: string, text: string): void {
  const tmp = tempPathFor(target)
  try {
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, target)
  } catch (err) {
    try {
      unlinkSync(tmp)
    } catch {
      // tmp may not exist if writeFileSync failed before flush — ignore
    }
    throw err
  }
}

export function writeJsonAtomic<T>(target: string, value: T): void {
  writeTextAtomic(target, JSON.stringify(value, null, 2))
}

const mutexChains = new Map<string, Promise<unknown>>()

export function withMutex<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = mutexChains.get(key) ?? Promise.resolve()
  const next = previous.then(() => fn(), () => fn())
  // Keep the chain advancing even if `fn` throws, but never let a rejection
  // leak out of the chained promise (would surface as unhandledRejection).
  mutexChains.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next as Promise<T>
}
