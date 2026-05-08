#!/usr/bin/env tsx
/**
 * list-stack-admins — print current Stack-Admins as JSON. Pipeable into
 * jq / other tooling.
 *
 * Usage:
 *   tsx scripts/admin/list-stack-admins.ts
 */

import { getStackAdmins } from '../../src/server/global-settings.ts'

function main() {
  const admins = getStackAdmins()
  process.stdout.write(JSON.stringify(admins, null, 2) + '\n')
}

try {
  main()
} catch (err) {
  console.error('[err]', err)
  process.exit(1)
}
