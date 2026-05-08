#!/usr/bin/env tsx
/**
 * promote-to-owner — break-glass: promote a user to `owner` in a
 * workspace. Useful when:
 *   - The only owner accidentally demoted themselves.
 *   - We need to onboard a new owner before the previous one is
 *     removed (the membership refuses to drop the last owner; this
 *     tool creates a second one explicitly).
 *
 * Usage:
 *   tsx scripts/admin/promote-to-owner.ts <user-id> <workspace-id>
 */

import { isValidSlug } from '../../src/server/data-paths.ts'
import {
  addMember,
  changeMemberRole,
  getMember,
  getWorkspaceMeta,
} from '../../src/server/workspace-store.ts'
import { getUserProfile } from '../../src/server/users-store.ts'

import { auditCli } from './_audit.ts'

async function main() {
  const userId = process.argv[2]
  const wsId = process.argv[3]
  if (!userId || !wsId || !isValidSlug(userId) || !isValidSlug(wsId)) {
    console.error('usage: tsx scripts/admin/promote-to-owner.ts <user-id> <workspace-id>')
    process.exit(2)
  }
  const profile = getUserProfile(userId)
  if (!profile) {
    console.error(`[err] user not found: ${userId}`)
    process.exit(3)
  }
  const ws = getWorkspaceMeta(wsId)
  if (!ws) {
    console.error(`[err] workspace not found: ${wsId}`)
    process.exit(3)
  }
  const existing = getMember(wsId, userId)
  if (existing) {
    if (existing.role === 'owner') {
      console.log(`[noop] ${userId} is already an owner of ${wsId}`)
      return
    }
    await changeMemberRole(wsId, userId, 'owner')
    console.log(`[ok] promoted ${userId} from ${existing.role} to owner in ${wsId}`)
  } else {
    await addMember({ wsId, userId, role: 'owner', addedBy: userId })
    console.log(`[ok] added ${userId} as owner of ${wsId}`)
  }
  await auditCli('promote_to_owner', { userId, wsId })
}

main().catch((err) => {
  console.error('[err]', err)
  process.exit(1)
})
