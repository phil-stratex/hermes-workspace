#!/usr/bin/env tsx
/**
 * remove-stack-admin — revoke Stack-Admin privileges.
 *
 * Lockout-Schutz: refuses to remove the last Stack-Admin so an
 * operator can't accidentally lock everyone out of the global
 * error-log. Promote a successor first
 * (`tsx scripts/admin/add-stack-admin.ts <successor>`).
 *
 * Usage:
 *   tsx scripts/admin/remove-stack-admin.ts <user-id>
 */

import { isValidSlug } from '../../src/server/data-paths.ts'
import { removeStackAdmin } from '../../src/server/global-settings.ts'

import { auditCli } from './_audit.ts'

async function main() {
  const userId = process.argv[2]
  if (!userId || !isValidSlug(userId)) {
    console.error('usage: tsx scripts/admin/remove-stack-admin.ts <user-id>')
    process.exit(1)
  }
  try {
    const result = await removeStackAdmin(userId, 'cli', 'cli')
    if (!result.removed) {
      console.log(`[noop] ${userId} is not a stack-admin`)
      return
    }
    await auditCli('stack_admin_removed', {
      target: userId,
      via: 'cli',
    })
    console.log(`[ok] revoked stack-admin from ${userId}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[err] ${msg}`)
    if (msg.includes('last stack-admin')) {
      console.error('      promote a successor first:')
      console.error('      tsx scripts/admin/add-stack-admin.ts <successor>')
    }
    process.exit(3)
  }
}

main().catch((err) => {
  console.error('[err]', err)
  process.exit(1)
})
