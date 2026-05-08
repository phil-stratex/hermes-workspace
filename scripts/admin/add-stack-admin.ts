#!/usr/bin/env tsx
/**
 * add-stack-admin — promote a user to Stack-Admin (global error-log
 * visibility + future global admin actions).
 *
 * Stack-Admin lives outside the per-workspace permission model
 * (`permissions.ts` is workspace-scoped). It is the only privilege
 * that crosses workspace boundaries — used today by the global
 * error-log, possibly by future cross-workspace admin tooling.
 *
 * Usage:
 *   tsx scripts/admin/add-stack-admin.ts <user-id>
 *
 * Idempotent: calling a second time on an existing Stack-Admin exits 0
 * with a [noop] message — no duplicate audit event.
 */

import { isValidSlug } from '../../src/server/data-paths.ts'
import { addStackAdmin } from '../../src/server/global-settings.ts'
import { getUserProfile } from '../../src/server/users-store.ts'

import { auditCli } from './_audit.ts'

async function main() {
  const userId = process.argv[2]
  if (!userId || !isValidSlug(userId)) {
    console.error('usage: tsx scripts/admin/add-stack-admin.ts <user-id>')
    process.exit(1)
  }
  const profile = getUserProfile(userId)
  if (!profile) {
    console.error(`[err] user not found: ${userId}`)
    console.error('      list known users with: tsx scripts/admin/list-users.ts')
    process.exit(2)
  }
  const result = await addStackAdmin(userId, 'cli', 'cli')
  if (!result.added) {
    console.log(`[noop] ${userId} is already a stack-admin (since ${result.entry.addedAt})`)
    return
  }
  await auditCli('stack_admin_added', {
    target: userId,
    via: 'cli',
  })
  console.log(`[ok] promoted ${userId} to stack-admin`)
}

main().catch((err) => {
  console.error('[err]', err)
  process.exit(1)
})
