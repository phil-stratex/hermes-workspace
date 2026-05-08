import { useEffect, useState } from 'react'

import { AddPeerWizard } from './federation/add-peer-wizard'
import { SyncWizard } from './federation/sync-wizard'

type Peer = {
  id: string
  name: string
  host: string
  sshUser: string
  sshPort?: number
  remoteWorkspaceId: string
  syncedTypes: Array<string>
  status: 'connected' | 'disconnected' | 'error'
  createdAt: string
  createdBy: string
  lastSync?: { at: string; summary: { in: number; out: number; conflicts: number } }
  notes?: string
}

/**
 * Federation tab — peer list + Add Peer + per-peer Sync wizard. Plan
 * B.3. Owner/admin only (gated upstream by the layout).
 *
 * Layout mirrors the Members tab: filterable table with status
 * badges, action menu per row.
 */
export function WorkspaceFederationTab() {
  const wsId = derivePathSegment('/workspace/', 1) ?? ''
  const [peers, setPeers] = useState<Array<Peer> | null>(null)
  const [error, setError] = useState('')
  const [activeWizard, setActiveWizard] = useState<
    | { kind: 'add' }
    | { kind: 'sync'; peer: Peer }
    | null
  >(null)

  async function reload() {
    if (!wsId) return
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(wsId)}/federation/peers`,
        { credentials: 'same-origin' },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { peers: Array<Peer> }
      setPeers(data.peers ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Laden')
    }
  }

  useEffect(() => {
    void reload()
  }, [wsId])

  async function connectPeer(peer: Peer): Promise<{ ok: boolean; reason?: string; details?: string }> {
    const res = await fetch(
      `/api/workspaces/${encodeURIComponent(wsId)}/federation/connect/${encodeURIComponent(peer.id)}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    )
    const body = await res.json() as { ok: boolean; reason?: string; details?: string }
    void reload()
    return body
  }

  async function disconnectPeer(peer: Peer): Promise<void> {
    await fetch(
      `/api/workspaces/${encodeURIComponent(wsId)}/federation/disconnect/${encodeURIComponent(peer.id)}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    )
    void reload()
  }

  async function deletePeer(peer: Peer): Promise<void> {
    if (!confirm(`Peer „${peer.name}" wirklich löschen?\nDer SSH-Key wird nicht entfernt — falls du ihn nochmal nutzen willst, fass die Datei in data/workspaces/${wsId}/federation/keys/${peer.id}.key an.`)) return
    await fetch(
      `/api/workspaces/${encodeURIComponent(wsId)}/federation/peers/${encodeURIComponent(peer.id)}`,
      { method: 'DELETE', credentials: 'same-origin' },
    )
    void reload()
  }

  if (error) return <Section><ErrorBox>{error}</ErrorBox></Section>
  if (peers === null) return <Section><Spinner /></Section>

  return (
    <Section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-primary-900">Federation</h2>
          <p className="mt-1 text-xs text-primary-600">
            On-Demand-Sync mit Peer-Stacks via SSH-Tunnel. Memories, Skills und shared Sessions werden manuell pro Sync übernommen — niemals automatisch.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActiveWizard({ kind: 'add' })}
          className="rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-600"
        >
          + Peer hinzufügen
        </button>
      </div>

      {peers.length === 0 ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-6 py-12 text-center">
          <p className="text-sm text-primary-700">
            Keine Federation-Peers konfiguriert.
          </p>
          <p className="mt-1 text-xs text-primary-500">
            Klick „+ Peer hinzufügen" um den ersten Stack zu verknüpfen.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-primary-200">
          <table className="w-full text-sm">
            <thead className="bg-primary-100 text-xs uppercase tracking-wide text-primary-600">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Host</th>
                <th className="px-3 py-2 text-left">Remote WS</th>
                <th className="px-3 py-2 text-left">Synct</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Letzter Sync</th>
                <th className="px-3 py-2 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {peers.map((p) => (
                <PeerRow
                  key={p.id}
                  peer={p}
                  onConnect={async () => {
                    const r = await connectPeer(p)
                    if (!r.ok) alert(`Verbindung fehlgeschlagen: ${r.reason ?? ''}\n${r.details ?? ''}`)
                  }}
                  onDisconnect={() => disconnectPeer(p)}
                  onSync={() => setActiveWizard({ kind: 'sync', peer: p })}
                  onDelete={() => deletePeer(p)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeWizard?.kind === 'add' && (
        <AddPeerWizard
          wsId={wsId}
          onClose={() => setActiveWizard(null)}
          onCreated={() => {
            setActiveWizard(null)
            void reload()
          }}
        />
      )}
      {activeWizard?.kind === 'sync' && (
        <SyncWizard
          wsId={wsId}
          peer={activeWizard.peer}
          onClose={() => {
            setActiveWizard(null)
            void reload()
          }}
        />
      )}
    </Section>
  )
}

function PeerRow({
  peer,
  onConnect,
  onDisconnect,
  onSync,
  onDelete,
}: {
  peer: Peer
  onConnect: () => void
  onDisconnect: () => void
  onSync: () => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <tr className="border-t border-primary-200">
      <td className="px-3 py-2">
        <div className="font-medium text-primary-900">{peer.name}</div>
        <div className="font-mono text-xs text-primary-500">{peer.id}</div>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-primary-700">
        {peer.sshUser}@{peer.host}{peer.sshPort && peer.sshPort !== 22 ? `:${peer.sshPort}` : ''}
      </td>
      <td className="px-3 py-2 text-primary-700">{peer.remoteWorkspaceId}</td>
      <td className="px-3 py-2 text-xs text-primary-700">
        {peer.syncedTypes.join(', ')}
      </td>
      <td className="px-3 py-2"><StatusBadge status={peer.status} /></td>
      <td className="px-3 py-2 text-xs text-primary-500">
        {peer.lastSync ? (
          <>
            {formatDate(peer.lastSync.at)}
            <div className="mt-0.5 text-[10px] text-primary-500/80">
              {peer.lastSync.summary.in} in / {peer.lastSync.summary.out} out / {peer.lastSync.summary.conflicts} conflicts
            </div>
          </>
        ) : '—'}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="relative inline-block text-left">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded p-1 text-primary-500 hover:bg-primary-200"
            aria-label="Aktionen"
          >⋯</button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-lg border border-primary-200 bg-primary-50 text-sm shadow-lg">
              {peer.status === 'connected' ? (
                <button onClick={() => { setMenuOpen(false); onSync() }} className="block w-full px-3 py-2 text-left hover:bg-primary-100">
                  Sync starten
                </button>
              ) : (
                <button onClick={() => { setMenuOpen(false); onConnect() }} className="block w-full px-3 py-2 text-left hover:bg-primary-100">
                  Verbinden
                </button>
              )}
              {peer.status === 'connected' && (
                <button onClick={() => { setMenuOpen(false); onDisconnect() }} className="block w-full border-t border-primary-200 px-3 py-2 text-left hover:bg-primary-100">
                  Disconnect
                </button>
              )}
              <button onClick={() => { setMenuOpen(false); onDelete() }} className="block w-full border-t border-primary-200 px-3 py-2 text-left text-red-600 hover:bg-red-50">
                Peer löschen
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

function StatusBadge({ status }: { status: 'connected' | 'disconnected' | 'error' }) {
  if (status === 'connected') return <span className="text-xs text-green-700">● connected</span>
  if (status === 'error') return <span className="text-xs text-red-700">⊘ error</span>
  return <span className="text-xs text-primary-500">○ disconnected</span>
}

function Section({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-5xl px-6 py-6">{children}</div>
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">{children}</div>
}

function Spinner() {
  return <div className="flex justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-300 border-t-accent-500" /></div>
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function derivePathSegment(prefix: string, idx: number): string | null {
  if (typeof window === 'undefined') return null
  const path = window.location.pathname
  if (!path.startsWith(prefix)) return null
  const parts = path.slice(prefix.length).split('/')
  return parts[idx] ?? null
}
