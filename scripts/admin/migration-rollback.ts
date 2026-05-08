#!/usr/bin/env tsx
/**
 * migration-rollback — reverse a multi-tenant migration.
 *
 * Two-mode (Plan-Finding N3):
 *
 *   --sidecar      Sidecar-pattern rollback. Single `mv` reverses the
 *                  staging→live rename. Keeps the failed staging dir
 *                  for forensics. Default mode of the migrate CLI.
 *
 *   --in-place     In-place rollback. Reads the manifest's
 *                  reverseMoves[] and copies each `to → from` back.
 *                  Slower, race-vulnerable mid-flight; only use when
 *                  the migrate ran with --in-place.
 *
 * Either mode also deletes `migration-completed.json` and
 * `migration-manifest.json` so the next boot treats the stack as
 * un-migrated. Combined with the sidecar `mv`, the legacy stack
 * resumes; combined with the in-place reverse moves, the data
 * directory returns to its pre-migrate shape.
 *
 * Usage:
 *   tsx scripts/admin/migration-rollback.ts --sidecar [--apply]
 *   tsx scripts/admin/migration-rollback.ts --in-place [--apply]
 *
 * Without `--apply` the script prints what it WOULD do and exits 0
 * (dry-run by default — destructive operations need an explicit flag).
 */

import { cpSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { auditCli } from './_audit.ts'
import { getGlobalDir } from '../../src/server/data-paths.ts'
import { rollbackFromManifest } from '../../src/server/migration.ts'

type Mode = 'sidecar' | 'in-place'

function parseArgs(argv: ReadonlyArray<string>): { mode: Mode | null; apply: boolean } {
  let mode: Mode | null = null
  let apply = false
  for (const a of argv) {
    if (a === '--sidecar') mode = 'sidecar'
    else if (a === '--in-place') mode = 'in-place'
    else if (a === '--apply') apply = true
    else if (a === '-h' || a === '--help') {
      printUsage()
      process.exit(0)
    } else {
      console.error('[err] unknown flag: ' + a)
      process.exit(2)
    }
  }
  return { mode, apply }
}

function printUsage(): void {
  console.log(`Usage: tsx scripts/admin/migration-rollback.ts (--sidecar | --in-place) [--apply]

Modes:
  --sidecar    rollback a sidecar migration: print mv steps, delete marker
  --in-place   rollback an in-place migration: copy each 'to → from' back, delete marker

Without --apply, the script prints actions and exits without mutating state.
`)
}

async function main(): Promise<void> {
  const { mode, apply } = parseArgs(process.argv.slice(2))
  if (!mode) {
    console.error('[err] mode required: --sidecar OR --in-place')
    printUsage()
    process.exit(2)
  }

  const manifestPath = join(getGlobalDir(), 'migration-manifest.json')
  if (!existsSync(manifestPath)) {
    console.error(`[err] manifest not found at ${manifestPath}`)
    process.exit(3)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    rollbackInstructions: {
      mode: Mode
      sidecarRollback?: { failedTarget: string; preMigrationSource: string }
      inPlaceRollback?: { reverseMoves: Array<{ from: string; to: string }> }
    }
    taggedSessions?: Array<unknown>
  }

  if (manifest.rollbackInstructions.mode !== mode) {
    console.error(
      `[err] manifest mode is '${manifest.rollbackInstructions.mode}' but you passed --${mode}.`,
    )
    process.exit(4)
  }

  if (mode === 'sidecar') {
    const sb = manifest.rollbackInstructions.sidecarRollback
    if (!sb) {
      console.error('[err] manifest.sidecarRollback missing')
      process.exit(5)
    }
    console.log('SIDECAR ROLLBACK')
    console.log(`  failedTarget:        ${sb.failedTarget}`)
    console.log(`  preMigrationSource:  ${sb.preMigrationSource}`)
    console.log()
    console.log('Operator action (run outside this script):')
    console.log(`  mv ${sb.failedTarget} ${sb.failedTarget}.failed`)
    console.log(`  mv ${sb.preMigrationSource} ${sb.failedTarget}`)
    console.log()
    if (!apply) {
      console.log('[dry-run] not deleting marker/manifest (pass --apply to clear them).')
      return
    }
    const result = rollbackFromManifest()
    await auditCli('migration_rollback', { mode: 'sidecar', cleared: result.cleared })
    console.log('[ok] cleared marker + manifest:')
    for (const c of result.cleared) console.log('     ' + c)
    return
  }

  // In-place mode.
  const ip = manifest.rollbackInstructions.inPlaceRollback
  if (!ip) {
    console.error('[err] manifest.inPlaceRollback missing')
    process.exit(5)
  }
  console.log('IN-PLACE ROLLBACK')
  console.log(`  reverseMoves: ${ip.reverseMoves.length}`)
  for (const m of ip.reverseMoves) console.log(`    ${m.from}  →  ${m.to}`)
  if (!apply) {
    console.log('[dry-run] not copying (pass --apply to perform).')
    return
  }
  for (const m of ip.reverseMoves) {
    if (!existsSync(m.from)) {
      console.warn(`[warn] reverse source missing, skipping: ${m.from}`)
      continue
    }
    cpSync(m.from, m.to, { recursive: true, force: true, errorOnExist: false })
    console.log(`[ok] restored ${m.to}`)
  }
  const result = rollbackFromManifest()
  await auditCli('migration_rollback', {
    mode: 'in-place',
    reversed: result.reversed.length,
    cleared: result.cleared,
  })
  console.log('[ok] cleared marker + manifest:')
  for (const c of result.cleared) console.log('     ' + c)
}

main().catch((err) => {
  console.error('[err]', err instanceof Error ? err.message : err)
  process.exit(1)
})
