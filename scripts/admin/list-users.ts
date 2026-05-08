#!/usr/bin/env tsx
/**
 * list-users — print every user profile as a JSON line on stdout.
 * Read-only, no audit event emitted.
 */

import { getUserProfile, listUsers } from '../../src/server/users-store.ts'

async function main() {
  for (const id of listUsers()) {
    const profile = getUserProfile(id)
    if (!profile) continue
    console.log(
      JSON.stringify({
        id: profile.id,
        email: profile.email,
        name: profile.name,
        status: profile.status,
        createdAt: profile.createdAt,
        lastLoginAt: profile.lastLoginAt,
        failedLoginCount: profile.failedLoginCount,
        defaultWorkspaceId: profile.defaultWorkspaceId,
        mustChangePassword: profile.mustChangePassword === true,
      }),
    )
  }
}

main().catch((err) => {
  console.error('[err]', err)
  process.exit(1)
})
