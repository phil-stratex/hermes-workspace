import { useEffect, useState } from 'react'

type AuditEntry = {
  schemaVersion: 1
  ts: string
  type: string
  prevHash: string
  thisHash: string
  [key: string]: unknown
}

type AuditResponse = {
  ok: true
  entries: Array<AuditEntry>
  brokenAt: number | null
  breakReason?: string
}

/**
 * Audit-Log viewer (Plan-Finding F10).
 *
 * The server recomputes the chain on every read; this UI surfaces the
 * verdict as a prominent banner + per-row indicator. Expanding a row
 * shows the full payload.
 */
export function WorkspaceAuditTab() {
  const wsId = derivePathSegment('/workspace/', 1) ?? ''
  const [days, setDays] = useState<Array<string>>([])
  const [date, setDate] = useState<string>(today())
  const [data, setData] = useState<AuditResponse | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    if (!wsId) return
    void fetch(
      `/api/workspaces/${encodeURIComponent(wsId)}/audit?listDays=1`,
      { credentials: 'same-origin' },
    )
      .then((r) => r.json())
      .then((d: { days?: Array<string> }) => setDays(d.days ?? []))
      .catch(() => setDays([]))
  }, [wsId])

  useEffect(() => {
    if (!wsId) return
    setData(null)
    void fetch(
      `/api/workspaces/${encodeURIComponent(wsId)}/audit?date=${encodeURIComponent(date)}`,
      { credentials: 'same-origin' },
    )
      .then((r) => r.json())
      .then((d: AuditResponse) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : 'Fehler'))
  }, [wsId, date])

  if (error) return <Section><ErrorBox>{error}</ErrorBox></Section>

  return (
    <Section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-primary-900">Audit Log</h2>
        <select
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-sm"
        >
          {(days.length === 0 ? [today()] : days).map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {!data ? <Spinner /> : (
        <>
          {data.brokenAt !== null && (
            <div className="mb-4 rounded-xl border-2 border-red-300 bg-red-50 px-5 py-4">
              <div className="text-sm font-bold text-red-700">
                ⚠ Hash-Chain-Bruch erkannt bei Eintrag #{data.brokenAt + 1}
              </div>
              <div className="mt-1 text-xs text-red-700/80">
                Grund: {data.breakReason ?? 'unbekannt'}
              </div>
              <div className="mt-2 text-xs text-red-700/80">
                Eine Ereignis-Kette wurde nachträglich verändert oder eine Zeile entfernt.
                Der Bruch wurde selbst als <code>chain_break_detected</code> ins Audit
                geschrieben — alle nachfolgenden Einträge bilden eine neue Chain ab dem Bruch-Punkt.
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-primary-200">
            <table className="w-full text-sm">
              <thead className="bg-primary-100 text-xs uppercase tracking-wide text-primary-600">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Zeit</th>
                  <th className="px-3 py-2 text-left">Typ</th>
                  <th className="px-3 py-2 text-left">Akteur</th>
                  <th className="px-3 py-2 text-left">Kette</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry, idx) => {
                  const broken = data.brokenAt !== null && idx === data.brokenAt
                  const actor = (entry.userId ?? entry.actorUserId ?? entry.triggeredBy ?? '—') as string
                  return (
                    <Row
                      key={idx}
                      idx={idx}
                      entry={entry}
                      actor={actor}
                      broken={broken}
                      expanded={expanded === idx}
                      onToggle={() => setExpanded(expanded === idx ? null : idx)}
                    />
                  )
                })}
                {data.entries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-sm text-primary-500">
                      Keine Einträge an diesem Tag.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  )
}

function Row({
  idx,
  entry,
  actor,
  broken,
  expanded,
  onToggle,
}: {
  idx: number
  entry: AuditEntry
  actor: string
  broken: boolean
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr
        className={`border-t border-primary-200 cursor-pointer hover:bg-primary-100/40 ${broken ? 'bg-red-50' : ''}`}
        onClick={onToggle}
      >
        <td className="px-3 py-2 text-xs text-primary-500">{idx + 1}</td>
        <td className="px-3 py-2 text-xs text-primary-700">{formatDate(entry.ts)}</td>
        <td className="px-3 py-2 font-mono text-xs text-primary-900">{entry.type}</td>
        <td className="px-3 py-2 text-xs text-primary-700">{actor}</td>
        <td className="px-3 py-2 text-xs">
          {broken ? <span className="text-red-700">✕ Bruch</span> : <span className="text-green-700">✓ OK</span>}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-primary-50/50">
          <td colSpan={5} className="px-6 py-3">
            <pre className="overflow-x-auto rounded-lg bg-primary-100 px-3 py-2 text-xs text-primary-900">{JSON.stringify(entry, null, 2)}</pre>
          </td>
        </tr>
      )}
    </>
  )
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' })
  } catch {
    return iso
  }
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

function derivePathSegment(prefix: string, idx: number): string | null {
  if (typeof window === 'undefined') return null
  const path = window.location.pathname
  if (!path.startsWith(prefix)) return null
  const parts = path.slice(prefix.length).split('/')
  return parts[idx] ?? null
}
