import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  addPeer,
  deletePeer,
  generatePeerId,
  getPeer,
  peerKeyPath,
  peerPublicKeyPath,
  readPeers,
  recordSyncSummary,
  setPeerStatus,
  updatePeer,
} from './federation-peers-store'

function makeAddInput(overrides: Partial<Parameters<typeof addPeer>[0]> = {}) {
  return {
    wsId: 'stratex',
    name: 'Lab Stack',
    host: '198.51.100.42',
    sshUser: 'root',
    publicKey: 'ssh-ed25519 AAAA…',
    sshKeyPath: '/dummy/key',
    remoteWorkspaceId: 'stratex',
    syncedTypes: ['memories' as const, 'skills' as const],
    createdBy: 'phil',
    ...overrides,
  }
}

describe('federation-peers-store', () => {
  let dataDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'fed-peers-'))
    process.env.HERMES_DATA_DIR = dataDir
    delete process.env.HERMES_HOME
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
    process.env = { ...originalEnv }
  })

  describe('readPeers', () => {
    it('returns empty for a fresh workspace', () => {
      const cfg = readPeers('stratex')
      expect(cfg.schemaVersion).toBe(1)
      expect(cfg.peers).toEqual([])
    })

    it('rejects invalid wsId', () => {
      expect(() => readPeers('../escape')).toThrow(/invalid wsId/)
    })
  })

  describe('addPeer', () => {
    it('persists a peer and returns it', async () => {
      const peer = await addPeer(makeAddInput())
      expect(peer.id).toMatch(/^[a-f0-9]{16}$/)
      expect(peer.host).toBe('198.51.100.42')
      expect(peer.status).toBe('disconnected')
      expect(peer.syncedTypes).toEqual(['memories', 'skills'])
      const back = readPeers('stratex')
      expect(back.peers.length).toBe(1)
    })

    it('rejects invalid remoteWorkspaceId', async () => {
      await expect(
        addPeer(makeAddInput({ remoteWorkspaceId: '../bad' })),
      ).rejects.toThrow(/invalid remoteWorkspaceId/)
    })

    it('rejects empty host or sshUser', async () => {
      await expect(addPeer(makeAddInput({ host: '' }))).rejects.toThrow(/host \+ sshUser/)
      await expect(addPeer(makeAddInput({ sshUser: '' }))).rejects.toThrow(/host \+ sshUser/)
    })
  })

  describe('updatePeer + setPeerStatus + recordSyncSummary', () => {
    it('updates an existing peer atomically', async () => {
      const peer = await addPeer(makeAddInput())
      const updated = await updatePeer('stratex', peer.id, (p) => ({
        ...p,
        notes: 'partner stack',
      }))
      expect(updated?.notes).toBe('partner stack')
    })

    it('refuses to change peer.id', async () => {
      const peer = await addPeer(makeAddInput())
      await expect(
        updatePeer('stratex', peer.id, (p) => ({ ...p, id: 'evil' })),
      ).rejects.toThrow(/must not change peer id/)
    })

    it('setPeerStatus + recordSyncSummary persist', async () => {
      const peer = await addPeer(makeAddInput())
      await setPeerStatus('stratex', peer.id, 'connected')
      await recordSyncSummary('stratex', peer.id, { in: 5, out: 3, conflicts: 1 })
      const back = getPeer('stratex', peer.id)
      expect(back?.status).toBe('connected')
      expect(back?.lastSync?.summary).toEqual({ in: 5, out: 3, conflicts: 1 })
    })

    it('returns null when peer is unknown', async () => {
      const r = await updatePeer('stratex', 'ghost', (p) => p)
      expect(r).toBeNull()
    })
  })

  describe('deletePeer', () => {
    it('drops the peer file entry', async () => {
      const peer = await addPeer(makeAddInput())
      const ok = await deletePeer('stratex', peer.id)
      expect(ok).toBe(true)
      expect(getPeer('stratex', peer.id)).toBeNull()
    })

    it('returns false for unknown peer', async () => {
      const ok = await deletePeer('stratex', 'nope')
      expect(ok).toBe(false)
    })
  })

  describe('atomic concurrent add', () => {
    it('20 parallel addPeer calls all land', async () => {
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          addPeer(makeAddInput({ name: `peer-${i}` })),
        ),
      )
      const cfg = readPeers('stratex')
      expect(cfg.peers).toHaveLength(20)
      const names = new Set(cfg.peers.map((p) => p.name))
      for (let i = 0; i < 20; i++) expect(names.has(`peer-${i}`)).toBe(true)
    })
  })

  describe('key paths', () => {
    it('peerKeyPath / peerPublicKeyPath match the wsId/peerId', () => {
      expect(peerKeyPath('stratex', 'abc123')).toMatch(/federation[\\/]keys[\\/]abc123\.key$/)
      expect(peerPublicKeyPath('stratex', 'abc123')).toMatch(/federation[\\/]keys[\\/]abc123\.key\.pub$/)
    })
  })

  describe('generatePeerId', () => {
    it('produces 16-char hex ids, all unique', () => {
      const set = new Set<string>()
      for (let i = 0; i < 100; i++) set.add(generatePeerId())
      expect(set.size).toBe(100)
      for (const id of set) expect(id).toMatch(/^[a-f0-9]{16}$/)
    })
  })
})
