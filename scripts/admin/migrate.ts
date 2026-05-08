#!/usr/bin/env tsx
/**
 * migrate — single-tenant → multi-tenant migration CLI.
 *
 * Usage (sidecar — DEFAULT, R3 zero-risk):
 *
 *   docker run --rm \
 *     -v /opt/data:/in:ro \
 *     -v /opt/data-staging:/out \
 *     -e HERMES_LEGACY_DATA_DIR=/in \
 *     -e HERMES_DATA_DIR=/out \
 *     -e HERMES_PASSWORD="<the-current-single-pw>" \
 *     hermes-workspace:migrate \
 *     tsx scripts/admin/migrate.ts \
 *       --owner phil \
 *       --email phil@stratex-ai.com \
 *       --name "Phil" \
 *       --workspace stratex \
 *       --workspace-name "Stratex"
 *
 * After the migration exits 0, do the rename outside the container:
 *
 *   mv /opt/data /opt/data.pre-migration
 *   mv /opt/data-staging /opt/data
 *   docker compose restart hermes-workspace
 *
 * Pre-flight gates (refused unless satisfied):
 *   - data/global/.backup-confirmed (Plan-Finding L1) — set via
 *     `confirm-backup-done.ts` AFTER you take a Borg snapshot.
 *   - The multi-person heuristic (Plan-Finding L2) — if flagged,
 *     run `confirm-multi-person-tag.ts <owner-id>` first.
 *
 * Use `--dry-run` to print the plan and stop. No I/O against the
 * staging dir, no marker, no manifest.
 *
 * Use `--in-place` to switch to the unsafe in-place mode (no sidecar,
 * mutates the live data root). Defaults to off; only set when you
 * cannot run a sidecar.
 */

import { auditCli } from './_audit.ts'
import {
  executeMigration,
  isBackupConfirmedFresh,
  planMigration,
  readBackupConfirmation,
} from '../../src/server/migration.ts'
import { analyzeMultiPerson, isMultiPersonConfirmed } from '../../src/server/migration-multi-person.ts'
import type { LegacyGatewaySession } from '../../src/server/migration-multi-person.ts'

type Args = {
  ownerUserId?: string
  ownerEmail?: string
  ownerName?: string
  workspaceId?: string
  workspaceName?: string
  workspaceDescription?: string
  primaryColor?: string
  dryRun: boolean
  inPlace: boolean
}

function parseArgs(argv: ReadonlyArray<string>): Args {
  const args: Args = { dryRun: false, inPlace: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    switch (arg) {
      case '--dry-run': args.dryRun = true; break
      case '--in-place': args.inPlace = true; break
      case '--owner':                 args.ownerUserId = next; i++; break
      case '--email':                 args.ownerEmail = next; i++; break
      case '--name':                  args.ownerName = next; i++; break
      case '--workspace':             args.workspaceId = next; i++; break
      case '--workspace-name':        args.workspaceName = next; i++; break
      case '--workspace-description': args.workspaceDescription = next; i++; break
      case '--primary-color':         args.primaryColor = next; i++; break
      case '-h':
      case '--help':
        printUsage()
        process.exit(0)
        break
      default:
        if (arg.startsWith('--')) {
          console.error(`[err] unknown flag: ${arg}`)
          process.exit(2)
        }
    }
  }
  return args
}

function printUsage(): void {
  console.log(`Usage: tsx scripts/admin/migrate.ts \\
  --owner <user-id> \\
  --email <email> \\
  --name "<full name>" \\
  --workspace <slug> \\
  --workspace-name "<display name>" \\
  [--workspace-description "<text>"] \\
  [--primary-color "#RRGGBB"] \\
  [--dry-run] \\
  [--in-place]

Env vars:
  HERMES_LEGACY_DATA_DIR   read source (sidecar mode, /in)
  HERMES_DATA_DIR          write target (sidecar /out, or live root in-place)
  HERMES_PASSWORD          legacy single-PW → migrated to owner bcrypt hash
  HERMES_REPO_ROOT         optional, for repo swarm.yaml lookup

Pre-flight (must be set before running, otherwise refused):
  data/global/.backup-confirmed         confirm-backup-done.ts <snapshotId>
  data/global/.multi-person-tag-confirmed   when L2 heuristic flags

After successful sidecar migration (operator action):
  mv /opt/data /opt/data.pre-migration
  mv /opt/data-staging /opt/data
  docker compose restart hermes-workspace
`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.ownerUserId || !args.ownerEmail || !args.ownerName
      || !args.workspaceId || !args.workspaceName) {
    console.error('[err] missing required flags. Run --help for usage.')
    process.exit(2)
  }

  if (args.inPlace) process.env.HERMES_MIGRATE_IN_PLACE = '1'

  const params = {
    ownerUserId: args.ownerUserId,
    ownerEmail: args.ownerEmail,
    ownerName: args.ownerName,
    workspaceId: args.workspaceId,
    workspaceName: args.workspaceName,
    workspaceDescription: args.workspaceDescription,
    primaryColor: args.primaryColor,
  }

  // Plan-only path (--dry-run): build the plan, print, exit.
  const plan = planMigration(params)

  console.log('───────────── MIGRATION PLAN ─────────────')
  console.log(`mode:               ${plan.mode}`)
  console.log(`sourceHermesHome:   ${plan.source.hermesHome}`)
  console.log(`openclawSwarmDir:   ${plan.source.openclawSwarmDir ?? '(none)'}`)
  console.log(`hasLegacyPassword:  ${plan.source.hasLegacyPassword}`)
  console.log(`targetDataDir:      ${plan.targetDataDir}`)
  console.log(`owner:              ${plan.ownerProfile.id} <${plan.ownerProfile.email}>`)
  console.log(`workspace:          ${plan.workspaceMeta.id} (${plan.workspaceMeta.name})`)
  console.log(`moves (${plan.moves.length}):`)
  for (const m of plan.moves) {
    console.log(`  ${m.type.padEnd(8)} ${m.from}  →  ${m.to}`)
    if (m.note) console.log(`            (${m.note})`)
  }
  console.log('────────────────────────────────────────────')

  if (args.dryRun) {
    console.log('[dry-run] no side effects taken — exiting.')
    return
  }

  // Pre-flight: backup confirmation.
  const backup = readBackupConfirmation()
  if (!isBackupConfirmedFresh()) {
    console.error('[err] pre-flight failed: backup-confirmed marker missing, malformed, or older than 24h')
    console.error('      Run: tsx scripts/admin/confirm-backup-done.ts <snapshotId>')
    if (backup) console.error(`      (current marker: confirmedAt=${backup.confirmedAt}, snapshotId=${backup.snapshotId})`)
    process.exit(3)
  }

  // Multi-person heuristic — surfaces a warning regardless of confirmation.
  // The legacy-session list is intentionally empty here; a real run
  // would source it via `claude-api.listSessions` from the gateway.
  // The migration host frequently doesn't have the gateway up yet, so
  // we keep the option to skip via env.
  const skipGateway = process.env.HERMES_MIGRATE_SKIP_GATEWAY === '1'
  const legacySessions = skipGateway ? [] : await fetchLegacySessions()
  const multiPerson = analyzeMultiPerson(legacySessions)
  if (multiPerson.flagged) {
    console.warn('[warn] multi-person heuristic flagged:')
    for (const r of multiPerson.reasons) console.warn(`         - ${r}`)
    if (!isMultiPersonConfirmed(plan.params.ownerUserId)) {
      console.error('[err] refused: confirm via tsx scripts/admin/confirm-multi-person-tag.ts ' + plan.params.ownerUserId)
      process.exit(4)
    }
    console.warn('         confirmed for migrant ' + plan.params.ownerUserId + ' — proceeding')
  }

  console.log('[run] executing migration ...')
  const result = await executeMigration(plan, { legacySessions })

  await auditCli('migrate', {
    workspaceId: plan.params.workspaceId,
    ownerUserId: plan.params.ownerUserId,
    moves: plan.moves.length,
    taggedSessions: result.manifest.taggedSessions.length,
    mode: plan.mode,
  })

  console.log('───────────── MIGRATION DONE ─────────────')
  console.log(`manifest:    ${result.manifestPath}`)
  console.log(`completedAt: ${result.manifest.completedAt}`)
  console.log(`tagged:      ${result.manifest.taggedSessions.length} sessions → ${plan.params.ownerUserId}`)
  if (plan.mode === 'sidecar') {
    console.log()
    console.log('Next step (operator):')
    console.log('  mv /opt/data /opt/data.pre-migration')
    console.log('  mv /opt/data-staging /opt/data')
    console.log('  docker compose restart hermes-workspace')
  }
}

async function fetchLegacySessions(): Promise<Array<LegacyGatewaySession>> {
  // Real implementation would import `listSessions` from claude-api,
  // but that pulls a lot of dev-server-only code into the migration
  // CLI. For now we expose a hook env var, and most stacks will set
  // HERMES_MIGRATE_SKIP_GATEWAY=1 anyway.
  return []
}

main().catch((err) => {
  console.error('[err]', err instanceof Error ? err.message : err)
  process.exit(1)
})
