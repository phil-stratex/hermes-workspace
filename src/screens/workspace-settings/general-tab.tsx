import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { useWorkspaceContext } from './hooks'

type WorkspaceMeta = {
  id: string
  name: string
  description?: string
  branding: { primaryColor: string; logoUrl?: string }
  settings: { defaultModel?: string; features: Record<string, boolean> }
  deletedAt?: string
  createdAt: string
}

export function WorkspaceGeneralTab() {
  // The wsId comes from the route params, parsed by the layout — for
  // simplicity we re-derive from the URL.
  const wsId = derivePathSegment('/workspace/', 1) ?? ''
  const ctx = useWorkspaceContext(wsId)

  const [meta, setMeta] = useState<WorkspaceMeta | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#5B6CFF')
  const [defaultModel, setDefaultModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState('')

  useEffect(() => {
    if (!wsId) return
    void fetch(`/api/workspaces/${encodeURIComponent(wsId)}`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d: { workspace?: WorkspaceMeta }) => {
        if (d.workspace) {
          setMeta(d.workspace)
          setName(d.workspace.name)
          setDescription(d.workspace.description ?? '')
          setPrimaryColor(d.workspace.branding.primaryColor)
          setDefaultModel(d.workspace.settings?.defaultModel ?? '')
        }
      })
  }, [wsId])

  if (!ctx || !meta) {
    return <SectionShell title="Allgemein"><Spinner /></SectionShell>
  }

  const isOwner = ctx.membership.role === 'owner'

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(wsId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name, description, primaryColor, defaultModel }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setMessage({ kind: 'ok', text: 'Gespeichert.' })
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Fehler' })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (confirmDelete !== meta!.id) return
    const res = await fetch(`/api/workspaces/${encodeURIComponent(wsId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    })
    if (res.ok) {
      window.location.assign('/')
    } else {
      setMessage({ kind: 'err', text: 'Löschen fehlgeschlagen.' })
    }
  }

  return (
    <SectionShell title="Allgemein">
      <form onSubmit={handleSave} className="space-y-4">
        <Field label="Workspace-ID">
          <input
            type="text"
            value={meta.id}
            readOnly
            className="w-full rounded-lg border border-primary-200 bg-primary-100 px-3 py-2 text-sm text-primary-600"
          />
        </Field>
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 outline-none"
          />
        </Field>
        <Field label="Beschreibung">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 outline-none"
          />
        </Field>
        <Field label="Farbe">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-lg border border-primary-200"
            />
            <input
              type="text"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              pattern="^#[0-9a-fA-F]{6}$"
              className="flex-1 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900"
            />
          </div>
        </Field>
        <Field label="Default Model" hint="Aus dem swarm.yaml-Roster — leer = Repo-Default">
          <input
            type="text"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder="kimi-k2.6"
            className="w-full rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900"
          />
        </Field>
        {message && (
          <div
            className={
              message.kind === 'ok'
                ? 'rounded-lg bg-green-50 px-4 py-2.5 text-sm text-green-700 ring-1 ring-green-200'
                : 'rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700 ring-1 ring-red-200'
            }
          >
            {message.text}
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
          >
            {saving ? 'Speichern...' : 'Änderungen speichern'}
          </button>
        </div>
      </form>

      {isOwner && (
        <div className="mt-10 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
          <h3 className="text-sm font-semibold text-red-700">Workspace löschen</h3>
          <p className="mb-3 mt-1 text-xs text-red-700/80">
            Soft-Delete mit 30 Tagen Recovery. Members verlieren sofort Zugang.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.value)}
              placeholder={`tippe „${meta.id}"`}
              className="flex-1 rounded-lg border border-red-200 bg-primary-50 px-3 py-2 text-sm text-primary-900"
            />
            <button
              type="button"
              onClick={handleDelete}
              disabled={confirmDelete !== meta.id}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Löschen
            </button>
          </div>
        </div>
      )}
    </SectionShell>
  )
}

// ─── helpers ───────────────────────────────────────────────────────────

function derivePathSegment(prefix: string, idx: number): string | null {
  if (typeof window === 'undefined') return null
  const path = window.location.pathname
  if (!path.startsWith(prefix)) return null
  const parts = path.slice(prefix.length).split('/')
  return parts[idx] ?? null
}

function SectionShell({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <h2 className="mb-6 text-lg font-semibold text-primary-900">{title}</h2>
      {children}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-primary-700">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-primary-500">{hint}</p>}
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-8">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-300 border-t-accent-500" />
    </div>
  )
}
