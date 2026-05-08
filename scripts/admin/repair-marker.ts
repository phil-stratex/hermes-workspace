#!/usr/bin/env tsx
/**
 * repair-marker — recover from `inconsistent` boot state (Plan F1).
 *
 * Triggered by the operator when `assertCoherentBootState()` refuses
 * to start the server because users exist but neither
 * `migration-completed.json` nor `migration-manifest.json` is present.
 *
 * Strategy:
 *   - If a manifest exists (`migration-manifest.json`), regenerate
 *     the marker (SHA256-self-checksummed) from it. Boot will then
 *     accept the state.
 *   - If neither exists, refuse — the operator must restore from
 *     backup. We don't fabricate a marker out of thin air, because
 *     that would mask data corruption.
 *
 * Usage:
 *   tsx scripts/admin/repair-marker.ts
 */

import { existsSync } from 'node:fs'

import { getManifestPath, isMarkerSelfChecksumValid, writeMarker } from '../../src/server/migration-marker.ts'

import { auditCli } from './_audit.ts'

async function main() {
  if (isMarkerSelfChecksumValid()) {
    console.log('[noop] marker is already valid — nothing to repair')
    return
  }
  if (!existsSync(getManifestPath())) {
    console.error('[err] no manifest at', getManifestPath())
    console.error('      → marker cannot be reconstructed safely')
    console.error('      → restore from a Borg snapshot taken AFTER the migration')
    process.exit(2)
  }
  const written = writeMarker()
  await auditCli('repair_marker', {
    markerPath: 'migration-completed.json',
    completedAt: written.completedAt,
  })
  console.log('[ok] marker reconstructed from manifest')
  console.log(`     completedAt: ${written.completedAt}`)
  console.log(`     selfChecksum: ${written.selfChecksum.slice(0, 16)}…`)
}

main().catch((err) => {
  console.error('[err]', err)
  process.exit(1)
})
