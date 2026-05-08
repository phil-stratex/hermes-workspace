#!/usr/bin/env tsx
/**
 * reset-password — break-glass recovery: generate a new temp PW for a
 * user, hash it server-side, set `mustChangePassword: true`, revoke
 * all of the user's existing session tokens, and print the plaintext
 * temp PW on stdout.
 *
 * Used when:
 *   - The owner forgot the only Owner password and is locked out.
 *   - An admin forgot the temp PW they generated for a member and
 *     needs to issue another one.
 *
 * Usage:
 *   tsx scripts/admin/reset-password.ts <user-id>
 */

import { generateTempPassword, hashPassword } from '../../src/server/auth-passwords.ts'
import { isValidSlug } from '../../src/server/data-paths.ts'
import { revokeAllUserSessionTokens } from '../../src/server/auth-middleware.ts'
import {
  getUserProfile,
  setPasswordHash,
  updateUserProfile,
} from '../../src/server/users-store.ts'

import { auditCli } from './_audit.ts'

async function main() {
  const userId = process.argv[2]
  if (!userId || !isValidSlug(userId)) {
    console.error('usage: tsx scripts/admin/reset-password.ts <user-id>')
    process.exit(2)
  }
  const profile = getUserProfile(userId)
  if (!profile) {
    console.error(`[err] user not found: ${userId}`)
    process.exit(3)
  }

  const tempPw = generateTempPassword()
  const hash = await hashPassword(tempPw)
  await setPasswordHash(userId, hash)
  await updateUserProfile(userId, (p) => (p ? { ...p, mustChangePassword: true } : null))
  await revokeAllUserSessionTokens(userId)

  await auditCli('reset_password', { targetUserId: userId })

  console.log('───────────────────────────────────────────────')
  console.log(`Temp password for ${userId} (${profile.email}):`)
  console.log()
  console.log(`    ${tempPw}`)
  console.log()
  console.log('  - Forward securely to the user (Slack, in person).')
  console.log('  - User must change it on next login.')
  console.log('  - All previous session tokens have been revoked.')
  console.log('───────────────────────────────────────────────')
}

main().catch((err) => {
  console.error('[err]', err)
  process.exit(1)
})
