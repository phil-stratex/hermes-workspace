/**
 * Error-log retention.
 *
 * Removes JSONL day-files older than `errors.retentionDays` (Default 30,
 * configurable via `data/global/settings.json`). Designed to run on a
 * timer (server-entry boots a daily setInterval) but is also safe to
 * call ad-hoc from a CLI.
 *
 * I1 — race-safety with concurrent appends. The naive "delete file
 * older than N days" loop is racy against `appendErrorEntry`: a kept
 * file (not eligible for deletion) wouldn't matter, but a file the
 * cron decides to delete COULD be in the middle of an `appendFileSync`
 * from a still-open writer if the system clock jumps or the cron runs
 * mid-day for a date that just-now became eligible.
 *
 * Fix: each `unlinkSync` happens inside the SAME per-date mutex
 * (`errors:<date>`) that `appendErrorEntry` uses. A pending append
 * either completes first (and the next delete-pass finds the bigger
 * file but still old, deletes it), or runs after the delete (and
 * `mkdirSync(dirname(file), { recursive: true })` plus `appendFileSync`
 * recreate the file with one fresh entry — which is fine; that entry
 * is from "today" so the next retention pass leaves it alone).
 *
 * What we explicitly do NOT try to defend against: an operator running
 * `rm -rf data/global/errors/` while writes are in flight. That is out
 * of scope for the in-process logger.
 */

import { existsSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

import { withMutex } from './atomic-write'
import { getErrorRetentionDays } from './global-settings'
import { getErrorsDir } from './error-store'

const FILE_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/

export type RetentionResult = {
  deleted: Array<string>
  kept: Array<string>
  retentionDays: number
}

/**
 * Run one pass of retention against the on-disk error log.
 *
 * `now` is dependency-injected so tests can pin a fixed clock.
 */
export async function runErrorRetention(now: Date = new Date()): Promise<RetentionResult> {
  const retentionDays = getErrorRetentionDays()
  const dir = getErrorsDir()
  const result: RetentionResult = { deleted: [], kept: [], retentionDays }
  if (!existsSync(dir)) return result

  // Cutoff is the START of the day `retentionDays` ago — files dated
  // strictly BEFORE that day are eligible.
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - retentionDays),
  )

  for (const fname of readdirSync(dir)) {
    const match = FILE_RE.exec(fname)
    if (!match) continue
    const date = match[1]
    const fileTs = Date.parse(`${date}T00:00:00.000Z`)
    if (Number.isNaN(fileTs)) continue
    if (fileTs >= cutoff.getTime()) {
      result.kept.push(fname)
      continue
    }
    // I1 — same mutex as appendErrorEntry to prevent race with a
    // concurrent writer on the same date.
    await withMutex(`errors:${date}`, async () => {
      const path = join(dir, fname)
      try {
        unlinkSync(path)
        result.deleted.push(fname)
      } catch {
        // file may have been removed between readdirSync and unlinkSync,
        // or someone is holding a Windows file-lock — best effort.
      }
    })
  }

  return result
}

let retentionTimer: ReturnType<typeof setInterval> | null = null

/**
 * Boot the daily retention timer. Idempotent — safe to call multiple
 * times during hot-reload. The first run is delayed to the next 03:30
 * UTC; subsequent runs every 24 h.
 */
export function startRetentionTimer(opts: { intervalMs?: number } = {}): void {
  if (retentionTimer) return
  const intervalMs = opts.intervalMs ?? 24 * 60 * 60 * 1000
  retentionTimer = setInterval(() => {
    void withMutex('errors:retention', async () => {
      await runErrorRetention()
    })
  }, intervalMs)
  // Don't keep the event-loop alive purely for the cron.
  if (typeof retentionTimer.unref === 'function') retentionTimer.unref()
}

/** Test-only: stop the timer. */
export function _stopRetentionTimerForTests(): void {
  if (retentionTimer) {
    clearInterval(retentionTimer)
    retentionTimer = null
  }
}
