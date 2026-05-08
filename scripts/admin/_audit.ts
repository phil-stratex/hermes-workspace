/**
 * Shared helper: emit a `cli_<action>` audit event for any admin
 * CLI tool (Plan-Finding F7). Auto-detects the OS user as
 * `triggeredBy`.
 */

import os from 'node:os'

import { appendAuditEvent } from '../../src/server/audit-log.ts'

export async function auditCli(
  action: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const triggeredBy = process.env.SUDO_USER || os.userInfo().username || 'unknown'
  await appendAuditEvent('global', {
    type: `cli_${action}`,
    triggeredBy,
    ...details,
  })
}
