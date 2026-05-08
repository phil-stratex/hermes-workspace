/**
 * Per-workspace federation peers (Phase B Plan).
 *
 * Layout: `data/workspaces/<wsId>/federation/peers.json`. The file is
 * **never** itself synced (Plan B.5 hardcoded filter) — it's local
 * configuration that says "this workspace can sync with these peers".
 *
 * SSH keys are stored under `data/workspaces/<wsId>/federation/keys/`
 * with one keypair per peer. The public key is shown to the user in
 * the AddPeerWizard so they can install it on the peer's
 * `authorized_keys`. The private key never leaves disk; the tunnel
 * lifecycle reads it via `ssh2`.
 *
 * Each peer carries a `remoteWorkspaceId` so the federation module
 * always knows which workspace to ask the peer about — peer-side will
 * launch the MCP server pinned to that wsId (`F2` boundary).
 *
 * All writes serialized via `withMutex(\`peers:\${wsId}\`)` (Plan F6).
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

import { writeJsonAtomic, withMutex } from './atomic-write'
import { getWorkspaceDir, isValidSlug } from './data-paths'
import { assertSchemaVersion } from './json-schema-version'

export const PEERS_SCHEMA_VERSION = 1

export type SyncedType =
  | 'memories'
  | 'skills'
  | 'council'
  | 'sessions-shared'
  | 'audit'
  | 'roster'

export type PeerStatus = 'connected' | 'disconnected' | 'error'

export type Peer = {
  id: string
  name: string
  host: string
  sshUser: string
  sshPort: number
  sshKeyPath: string
  publicKey: string
  remoteWorkspaceId: string
  syncedTypes: ReadonlyArray<SyncedType>
  status: PeerStatus
  createdAt: string
  createdBy: string
  lastSync?: {
    at: string
    summary: { in: number; out: number; conflicts: number }
  }
  notes?: string
}

export type PeersConfig = {
  schemaVersion: 1
  peers: Array<Peer>
}

const EMPTY: PeersConfig = { schemaVersion: 1, peers: [] }

function peersPath(wsId: string): string {
  return join(getWorkspaceDir(wsId), 'federation', 'peers.json')
}

function keysDir(wsId: string): string {
  return join(getWorkspaceDir(wsId), 'federation', 'keys')
}

function peersMutex(wsId: string): string {
  return `peers:${wsId}`
}

function ensureValidWsId(wsId: string): void {
  if (!isValidSlug(wsId)) throw new Error(`[federation-peers] invalid wsId: ${JSON.stringify(wsId)}`)
}

export function readPeers(wsId: string): PeersConfig {
  ensureValidWsId(wsId)
  const path = peersPath(wsId)
  if (!existsSync(path)) return EMPTY
  try {
    return assertSchemaVersion<PeersConfig>(JSON.parse(readFileSync(path, 'utf8')), 1, path)
  } catch {
    return EMPTY
  }
}

export function getPeer(wsId: string, peerId: string): Peer | null {
  return readPeers(wsId).peers.find((p) => p.id === peerId) ?? null
}

export function generatePeerId(): string {
  return randomBytes(8).toString('hex')
}

export type AddPeerInput = {
  wsId: string
  name: string
  host: string
  sshUser: string
  sshPort?: number
  publicKey: string
  /** Path to the private key on the local filesystem (created by the wizard). */
  sshKeyPath: string
  remoteWorkspaceId: string
  syncedTypes: ReadonlyArray<SyncedType>
  createdBy: string
  notes?: string
}

export async function addPeer(input: AddPeerInput): Promise<Peer> {
  ensureValidWsId(input.wsId)
  if (!isValidSlug(input.remoteWorkspaceId)) {
    throw new Error(`[federation-peers] invalid remoteWorkspaceId: ${JSON.stringify(input.remoteWorkspaceId)}`)
  }
  if (!isValidSlug(input.createdBy)) {
    throw new Error(`[federation-peers] invalid createdBy: ${JSON.stringify(input.createdBy)}`)
  }
  if (input.host.length === 0 || input.sshUser.length === 0) {
    throw new Error('[federation-peers] host + sshUser required')
  }
  return withMutex(peersMutex(input.wsId), async () => {
    const current = readPeers(input.wsId)
    const peer: Peer = {
      id: generatePeerId(),
      name: input.name,
      host: input.host,
      sshUser: input.sshUser,
      sshPort: input.sshPort ?? 22,
      sshKeyPath: input.sshKeyPath,
      publicKey: input.publicKey,
      remoteWorkspaceId: input.remoteWorkspaceId,
      syncedTypes: [...input.syncedTypes],
      status: 'disconnected',
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
      notes: input.notes,
    }
    const next: PeersConfig = {
      schemaVersion: 1,
      peers: [...current.peers, peer],
    }
    mkdirSync(dirname(peersPath(input.wsId)), { recursive: true })
    mkdirSync(keysDir(input.wsId), { recursive: true })
    writeJsonAtomic(peersPath(input.wsId), next)
    return peer
  })
}

export type UpdatePeerPatch = (current: Peer) => Peer

export async function updatePeer(
  wsId: string,
  peerId: string,
  patch: UpdatePeerPatch,
): Promise<Peer | null> {
  ensureValidWsId(wsId)
  return withMutex(peersMutex(wsId), async () => {
    const current = readPeers(wsId)
    const idx = current.peers.findIndex((p) => p.id === peerId)
    if (idx === -1) return null
    const updated = patch(current.peers[idx])
    if (updated.id !== peerId) {
      throw new Error('[federation-peers] patch must not change peer id')
    }
    const next: PeersConfig = {
      schemaVersion: 1,
      peers: current.peers.map((p, i) => (i === idx ? updated : p)),
    }
    writeJsonAtomic(peersPath(wsId), next)
    return updated
  })
}

export async function setPeerStatus(
  wsId: string,
  peerId: string,
  status: PeerStatus,
): Promise<Peer | null> {
  return updatePeer(wsId, peerId, (p) => ({ ...p, status }))
}

export async function recordSyncSummary(
  wsId: string,
  peerId: string,
  summary: { in: number; out: number; conflicts: number },
): Promise<Peer | null> {
  return updatePeer(wsId, peerId, (p) => ({
    ...p,
    lastSync: { at: new Date().toISOString(), summary },
  }))
}

export async function deletePeer(wsId: string, peerId: string): Promise<boolean> {
  ensureValidWsId(wsId)
  return withMutex(peersMutex(wsId), async () => {
    const current = readPeers(wsId)
    if (!current.peers.some((p) => p.id === peerId)) return false
    const next: PeersConfig = {
      schemaVersion: 1,
      peers: current.peers.filter((p) => p.id !== peerId),
    }
    writeJsonAtomic(peersPath(wsId), next)
    return true
  })
}

export function peerKeyPath(wsId: string, peerId: string): string {
  return join(keysDir(wsId), `${peerId}.key`)
}

export function peerPublicKeyPath(wsId: string, peerId: string): string {
  return join(keysDir(wsId), `${peerId}.key.pub`)
}
