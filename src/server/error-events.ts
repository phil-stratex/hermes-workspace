/**
 * In-process publish/subscribe for newly-appended error entries.
 *
 * `error-store.appendErrorEntry` calls `publishErrorEntry(entry)` after
 * a successful write so SSE subscribers in `routes/api/errors.stream`
 * see the entry within a few ms — no file-watcher required.
 *
 * Hard cap mirrors `chat-event-bus.ts:18` — a leaked SSE handler can't
 * grow the subscriber set without bound. At ~1 KB per closure plus the
 * per-event fan-out cost, an unbounded set silently turns into a
 * memory + CPU regression.
 */

import type { ErrorEntry } from './error-types'

const MAX_SUBSCRIBERS = 20

const subscribers = new Set<(entry: ErrorEntry) => void>()

export function publishErrorEntry(entry: ErrorEntry): void {
  for (const fn of subscribers) {
    try {
      fn(entry)
    } catch {
      // subscriber error — never let it kill the publish loop
    }
  }
}

export function subscribeToErrorEntries(fn: (entry: ErrorEntry) => void): () => void {
  if (subscribers.size >= MAX_SUBSCRIBERS) {
    return () => {}
  }
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

/** Test-only inspector. */
export function _subscriberCountForTests(): number {
  return subscribers.size
}
