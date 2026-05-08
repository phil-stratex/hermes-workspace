#!/usr/bin/env tsx
/**
 * list-workspaces — print every workspace + its members as JSON. Use
 * `--include-deleted` to also surface soft-deleted workspaces. Read
 * only, no audit event.
 */

import {
  getWorkspaceMembers,
  getWorkspaceMeta,
  listWorkspaces,
} from '../../src/server/workspace-store.ts'

async function main() {
  const includeDeleted = process.argv.includes('--include-deleted')
  for (const id of listWorkspaces({ includeDeleted })) {
    const meta = getWorkspaceMeta(id)
    const members = getWorkspaceMembers(id).members
    console.log(
      JSON.stringify({
        id,
        name: meta?.name,
        deletedAt: meta?.deletedAt,
        createdAt: meta?.createdAt,
        createdBy: meta?.createdBy,
        memberCount: members.length,
        owners: members.filter((m) => m.role === 'owner').map((m) => m.userId),
        admins: members.filter((m) => m.role === 'admin').map((m) => m.userId),
        members: members.filter((m) => m.role === 'member').map((m) => m.userId),
      }),
    )
  }
}

main().catch((err) => {
  console.error('[err]', err)
  process.exit(1)
})
