#!/usr/bin/env tsx
/**
 * Federation MCP server — stdio entry point (Plan B Phase B.1).
 *
 * Wired into the peer's SSH `authorized_keys` via the
 * `command="..."` restriction so a federation peer can only invoke
 * this binary, never an interactive shell. Plan-Finding F4:
 *
 *   command="docker exec -i <workspace-container> tsx scripts/mcp-federation-stdio.ts --workspace-id stratex",no-port-forwarding,no-X11-forwarding,no-pty <ssh-key>
 *
 * Process model:
 *   - Argv parses `--workspace-id <slug>` exactly once. Missing or
 *     malformed → exit 2 with a clear stderr message. The SSH command
 *     restriction means the peer can't pass a different workspace.
 *   - JSON-RPC 2.0 frames arrive on stdin as one JSON object per line
 *     (newline-delimited). Responses go to stdout in the same format.
 *   - Audit events emitted by the server land in the parent app's
 *     `data/global/audit/` via `audit-log.ts` — same store the live
 *     UI surfaces.
 *
 * Plan-Finding F2: workspace boundary is enforced inside every tool
 * call via `resolveSafe()`; this entry point's job is to make the
 * workspace context immutable for the duration of the connection.
 */

import { createInterface } from 'node:readline'

import { createServerContext, handleRequest } from '../src/server/federation-mcp-server.ts'

function parseArgs(argv: ReadonlyArray<string>): { workspaceId: string | null } {
  let workspaceId: string | null = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--workspace-id' && i + 1 < argv.length) {
      workspaceId = argv[i + 1]
      i++
    }
  }
  return { workspaceId }
}

async function main(): Promise<void> {
  const { workspaceId } = parseArgs(process.argv.slice(2))
  if (!workspaceId) {
    process.stderr.write('[mcp-federation-stdio] --workspace-id <slug> required\n')
    process.exit(2)
  }
  let ctx
  try {
    ctx = createServerContext(workspaceId)
  } catch (err) {
    process.stderr.write(`[mcp-federation-stdio] ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(2)
  }

  process.stderr.write(`[mcp-federation-stdio] ready for workspace=${ctx.workspaceId}\n`)

  // Newline-delimited JSON over stdio. ssh client → stdin → us → stdout
  // → ssh client.
  const rl = createInterface({ input: process.stdin, terminal: false })
  rl.on('line', async (line) => {
    const trimmed = line.trim()
    if (trimmed.length === 0) return
    const response = await handleRequest(ctx, trimmed)
    process.stdout.write(JSON.stringify(response) + '\n')
  })
  rl.on('close', () => process.exit(0))
}

main().catch((err) => {
  process.stderr.write(`[mcp-federation-stdio] fatal: ${err instanceof Error ? err.stack ?? err.message : err}\n`)
  process.exit(1)
})
