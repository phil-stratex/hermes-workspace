#!/usr/bin/env tsx
/**
 * confirm-multi-person-tag — acknowledge that the migration is about
 * to tag every gateway session to a single migrating user, even
 * though heuristics suggest multiple humans may have been logged in
 * to the legacy stack (Plan-Finding L2).
 *
 * Writes `data/global/.multi-person-tag-confirmed` so the migration's
 * detection step passes. Audit event names the operator + the chosen
 * migrating-user.
 *
 * Usage:
 *   tsx scripts/admin/confirm-multi-person-tag.ts <migrating-user-id>
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'

import { getGlobalDir, isValidSlug } from '../../src/server/data-paths.ts'
import { auditCli } from './_audit.ts'

async function main() {
  const migrant = process.argv[2]
  if (!migrant || !isValidSlug(migrant)) {
    console.error('usage: tsx scripts/admin/confirm-multi-person-tag.ts <user-id>')
    console.error('  <user-id>   slug of the user to tag the legacy sessions to')
    process.exit(2)
  }
  const path = join(getGlobalDir(), '.multi-person-tag-confirmed')
  const triggeredBy = process.env.SUDO_USER || os.userInfo().username || 'unknown'
  const body = {
    confirmedAt: new Date().toISOString(),
    migrantUserId: migrant,
    confirmedBy: triggeredBy,
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(body, null, 2), { encoding: 'utf8', mode: 0o600 })
  await auditCli('multi_person_tag_confirm', body)
  console.log(`[ok] wrote ${path}`)
  console.log(`     migrant: ${migrant}`)
  console.log(`     confirmedBy: ${body.confirmedBy}`)
}

main().catch((err) => {
  console.error('[err]', err)
  process.exit(1)
})
