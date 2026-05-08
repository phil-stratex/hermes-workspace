/**
 * SSH key + tunnel lifecycle (Plan B Phase B.1 skeleton).
 *
 * The full tunnel implementation lands in Phase B.2 alongside the
 * sync engine. For now this module exposes:
 *
 *   - `generateKeypair(wsId, peerId)` — uses ssh-keygen via spawn
 *     (no extra deps) to produce ed25519 keys under the peer's
 *     federation/keys directory. Returns the public key the
 *     `AddPeerWizard` shows the operator.
 *   - `buildAuthorizedKeysLine(opts)` — produces the exact
 *     `command="..."` line the peer admin needs to paste. Plan-
 *     Finding F4: the restriction binds the connection to one
 *     specific workspace via `--workspace-id <slug>`.
 *   - `testConnection(peer)` — runs `ssh ... 'true'` once and
 *     reports whether the SSH handshake + the
 *     `command="..."`-restriction work. Used by the wizard.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { peerKeyPath, peerPublicKeyPath } from './federation-peers-store'
import { getWorkspaceDir } from './data-paths'

export type GeneratedKeypair = {
  privateKeyPath: string
  publicKeyPath: string
  publicKey: string
}

export function generateKeypair(opts: {
  wsId: string
  peerId: string
  comment?: string
}): GeneratedKeypair {
  const privateKeyPath = peerKeyPath(opts.wsId, opts.peerId)
  const publicKeyPath = peerPublicKeyPath(opts.wsId, opts.peerId)
  mkdirSync(dirname(privateKeyPath), { recursive: true, mode: 0o700 })

  const result = spawnSync(
    'ssh-keygen',
    [
      '-t', 'ed25519',
      '-N', '',
      '-f', privateKeyPath,
      '-C', opts.comment ?? `hermes-federation:${opts.wsId}:${opts.peerId}`,
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error(`[federation-tunnel] ssh-keygen failed: ${result.stderr || result.stdout}`)
  }
  if (!existsSync(publicKeyPath)) {
    throw new Error(`[federation-tunnel] ssh-keygen did not write ${publicKeyPath}`)
  }
  const publicKey = readFileSync(publicKeyPath, 'utf8').trim()
  return { privateKeyPath, publicKeyPath, publicKey }
}

/**
 * Builds the `authorized_keys` line the peer admin pastes on their
 * VPS. Plan-Finding F4: the `command=` restriction binds a single
 * SSH key to invoking the federation MCP server for one specific
 * workspace, with no shell, no port-forwarding, no agent-forwarding,
 * no PTY.
 */
export function buildAuthorizedKeysLine(opts: {
  containerName: string
  remoteWorkspaceId: string
  publicKey: string
  /**
   * Where the peer-side workspace tree is mounted inside its
   * container. Only used to compose the `tsx scripts/...` path; the
   * caller passes their actual mount.
   */
  appPath?: string
}): string {
  const appPath = opts.appPath ?? '/app'
  const cmd =
    `docker exec -i ${opts.containerName} `
    + `tsx ${appPath}/scripts/mcp-federation-stdio.ts `
    + `--workspace-id ${opts.remoteWorkspaceId}`
  const restrictions = [
    `command="${cmd}"`,
    'no-port-forwarding',
    'no-X11-forwarding',
    'no-agent-forwarding',
    'no-pty',
  ].join(',')
  return `${restrictions} ${opts.publicKey.trim()}`
}

export type ConnectionTest =
  | { ok: true; output: string }
  | { ok: false; reason: 'ssh-failed' | 'unrestricted' | 'unknown'; details: string }

/**
 * Probe the SSH path. In the happy case (`command=` correctly set),
 * the peer side will run our `mcp-federation-stdio` and exit when
 * stdin closes — we observe a clean exit. If the restriction is
 * missing, `ssh peer "true"` will succeed and the peer's shell will
 * print nothing — that's our "unrestricted" signal.
 */
export function testConnection(opts: {
  user: string
  host: string
  port?: number
  privateKeyPath: string
  /** Override invoked instead of spawning real ssh — for tests. */
  spawnImpl?: (args: ReadonlyArray<string>) => { status: number | null; stdout: string; stderr: string }
}): ConnectionTest {
  const args = [
    '-i', opts.privateKeyPath,
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-p', String(opts.port ?? 22),
    `${opts.user}@${opts.host}`,
    'echo __unrestricted_shell__',
  ]
  const result = opts.spawnImpl
    ? opts.spawnImpl(args)
    : spawnSync('ssh', args, { encoding: 'utf8' })
  if (result.status === 0 && (result.stdout ?? '').includes('__unrestricted_shell__')) {
    return {
      ok: false,
      reason: 'unrestricted',
      details: 'The peer accepted the key WITHOUT a command="..."-restriction — this is unsafe. Add the restriction line on the peer.',
    }
  }
  // The expected `mcp-federation-stdio` will not echo our argv. A
  // missing-stdin EOF on the peer side typically yields stderr = the
  // ready-message and exit 0 (the script reads no input then quits).
  if (result.status === 0) return { ok: true, output: result.stderr || result.stdout }
  return {
    ok: false,
    reason: 'ssh-failed',
    details: `ssh exited ${result.status ?? 'null'}: ${result.stderr ?? result.stdout ?? ''}`,
  }
}

void getWorkspaceDir
