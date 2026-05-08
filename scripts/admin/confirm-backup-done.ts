#!/usr/bin/env tsx
/**
 * confirm-backup-done — pre-flight gate for the migration.
 *
 * Writes `data/global/.backup-confirmed` (JSON) so that
 * `migration.ts`'s pre-flight check passes (Plan-Finding L1 / N6).
 * Marker has a 24h TTL — older confirmations don't unlock a fresh
 * migration.
 *
 * Usage:
 *   tsx scripts/admin/confirm-backup-done.ts <snapshotId>
 *
 * Where `<snapshotId>` is the Borg archive name you just took
 * (something like `pre-multitenant-2026-05-08-1530`).
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'

import { getGlobalDir } from '../../src/server/data-paths.ts'
import { auditCli } from './_audit.ts'

async function main() {
  const snapshotId = process.argv[2]
  if (!snapshotId || snapshotId.trim().length === 0) {
    console.error('usage: tsx scripts/admin/confirm-backup-done.ts <snapshotId>')
    console.error('  <snapshotId>   the Borg archive name you just took')
    process.exit(2)
  }
  const path = join(getGlobalDir(), '.backup-confirmed')
  const triggeredBy = process.env.SUDO_USER || os.userInfo().username || 'unknown'
  const body = {
    confirmedAt: new Date().toISOString(),
    snapshotId: snapshotId.trim(),
    confirmedBy: triggeredBy,
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(body, null, 2), { encoding: 'utf8', mode: 0o600 })
  await auditCli('backup_confirm', { snapshotId: body.snapshotId, path })
  console.log(`[ok] wrote ${path}`)
  console.log(`     snapshotId: ${body.snapshotId}`)
  console.log(`     confirmedBy: ${body.confirmedBy}`)
  console.log(`     valid for 24h`)
}

main().catch((err) => {
  console.error('[err]', err)
  process.exit(1)
})
