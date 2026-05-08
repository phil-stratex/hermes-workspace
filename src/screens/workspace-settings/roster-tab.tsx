import { useEffect, useState } from 'react'

type Issue = {
  wsId: string
  file: string
  errors: Array<string>
}

/**
 * Roster tab — surfaces the contents of `data/global/swarm-yaml-issues.json`
 * so the workspace owner can react to broken Custom-roster references.
 *
 * Phase A.7 keeps this intentionally read-only: the actual editor
 * (Customize / Reset to Default) lands in a follow-up patch. For now
 * the tab tells the user the status and links to the docs.
 */
export function WorkspaceRosterTab() {
  const wsId = derivePathSegment('/workspace/', 1) ?? ''
  const [issues, setIssues] = useState<Array<Issue> | null>(null)
  const [scannedAt, setScannedAt] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void fetch('/api/swarm-yaml-issues', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d: { issues?: Array<Issue>; scannedAt?: string | null }) => {
        setIssues(d.issues ?? [])
        setScannedAt(d.scannedAt ?? null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Fehler'))
  }, [])

  if (error) return <Section title="Roster"><ErrorBox>{error}</ErrorBox></Section>
  if (issues === null) return <Section title="Roster"><Spinner /></Section>

  const myIssues = issues.filter((i) => i.wsId === wsId)
  const isCustom = myIssues.length > 0

  return (
    <Section title="Roster">
      <div className="mb-6 rounded-xl border border-primary-200 bg-primary-50 px-5 py-4">
        <div className="mb-1 text-xs uppercase tracking-wide text-primary-600">
          Status
        </div>
        <div className="text-sm font-medium text-primary-900">
          {isCustom ? 'Custom-Roster' : 'Default-Roster (vom Repo geerbt)'}
        </div>
        {scannedAt && (
          <div className="mt-1 text-xs text-primary-500">
            Validiert: {formatDate(scannedAt)}
          </div>
        )}
      </div>

      {myIssues.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <h3 className="mb-2 text-sm font-semibold text-amber-800">
            ⚠ Custom-Roster veraltet
          </h3>
          <p className="mb-3 text-xs text-amber-700">
            Dein workspace-eigenes <code>swarm.yaml</code> referenziert Worker-IDs,
            die im aktuellen Code nicht (mehr) existieren. Bis Du das behebst,
            startet der Roster-Tab im Default-Modus.
          </p>
          <ul className="ml-4 list-disc space-y-1 text-xs text-amber-700">
            {myIssues.flatMap((i) => i.errors.map((e, idx) => <li key={`${i.file}-${idx}`}>{e}</li>))}
          </ul>
          <p className="mt-3 text-xs text-amber-700/80">
            Datei: <code>{myIssues[0]!.file}</code>
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-5 py-4">
          <p className="text-sm text-primary-700">
            Keine Probleme erkannt. Der Roster-Editor (Customize / Reset to
            Default) folgt in einem separaten Patch.
          </p>
        </div>
      )}
    </Section>
  )
}

// ─── shared helpers (duplicated from members-tab to keep tabs decoupled) ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <h2 className="mb-6 text-lg font-semibold text-primary-900">{title}</h2>
      {children}
    </div>
  )
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
