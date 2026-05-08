/**
 * Bootstrap-coherence check (Plan-Finding F1).
 *
 * On every server start we examine three artefacts:
 *
 *   - whether any user profiles exist under `data/users/`
 *   - whether `data/global/migration-completed.json` exists and its
 *     self-checksum is intact
 *   - whether `data/global/migration-manifest.json` exists
 *
 * The combination produces one of four states:
 *
 *   1. fresh-stack         (no users, no marker, no manifest)
 *      → Setup-Wizard offers to create the first owner and workspace.
 *
 *   2. normal               (users + valid marker)
 *      → Boot proceeds, no action needed.
 *
 *   3. recovery-via-manifest (users, no/corrupt marker, but manifest)
 *      → L4 cross-check kicks in: migration is treated as completed
 *        even though the marker is gone. Boot proceeds with a warning.
 *
 *   4. inconsistent         (users + no marker + no manifest)
 *      → REFUSE TO BOOT. This combination means someone deleted the
 *        marker AND the manifest from a stack that already has users.
 *        Re-running migration would overwrite the existing
 *        layout. The operator must repair the marker manually via
 *        `scripts/admin/repair-marker.ts`.
 *
 * Without this check, state #4 silently triggers the Setup-Wizard,
 * which would create a *second* owner alongside the existing users —
 * a privilege-drift footgun.
 */

import { existsSync } from 'node:fs'

import { getManifestPath, isMarkerSelfChecksumValid } from './migration-marker'
import { listUsers } from './users-store'

export type BootState =
  | 'fresh-stack'
  | 'normal'
  | 'recovery-via-manifest'
  | 'inconsistent'

export type BootStateReport = {
  state: BootState
  usersExist: boolean
  markerValid: boolean
  manifestExists: boolean
  reason: string
}

export function describeBootState(): BootStateReport {
  const users = listUsers()
  const usersExist = users.length > 0
  const markerValid = isMarkerSelfChecksumValid()
  const manifestExists = existsSync(getManifestPath())

  if (!usersExist && !markerValid && !manifestExists) {
    return {
      state: 'fresh-stack',
      usersExist,
      markerValid,
      manifestExists,
      reason: 'no users + no migration marker + no manifest → Setup-Wizard',
    }
  }
  if (usersExist && markerValid) {
    return {
      state: 'normal',
      usersExist,
      markerValid,
      manifestExists,
      reason: 'users exist + marker is valid',
    }
  }
  if (usersExist && !markerValid && manifestExists) {
    return {
      state: 'recovery-via-manifest',
      usersExist,
      markerValid,
      manifestExists,
      reason: 'users exist + marker missing/corrupt + manifest acts as second proof (L4)',
    }
  }
  return {
    state: 'inconsistent',
    usersExist,
    markerValid,
    manifestExists,
    reason: usersExist
      ? 'users exist but neither marker nor manifest — refusing to boot'
      : 'partial state without users — refusing to boot',
  }
}

/**
 * Throws on `inconsistent` state with an operator-actionable message.
 * Call from `server-entry.js` BEFORE the migration trigger.
 */
export function assertCoherentBootState(): BootStateReport {
  const report = describeBootState()
  if (report.state === 'inconsistent') {
    const lines = [
      '[boot] BLOCKED: incoherent stack state.',
      `  users: ${report.usersExist}, marker: ${report.markerValid ? 'valid' : 'missing/invalid'}, manifest: ${report.manifestExists}`,
      `  ${report.reason}`,
      '  Recovery: docker exec <container> node scripts/admin/repair-marker.js',
    ]
    throw new Error(lines.join('\n'))
  }
  return report
}
