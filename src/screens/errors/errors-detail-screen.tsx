import { useState } from 'react'
import { useParams, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, Bug02Icon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { BuilderBriefModal } from './components/builder-brief-modal'

type DetailResponse = {
  ok: boolean
  entry?: {
    id: string
    ts: string
    lastOccurrenceAt?: string
    occurrences?: number
    level: string
    source: string
    message: string
    stack?: string
    context?: Record<string, unknown>
    browser?: { userAgent?: string; url?: string; viewport?: { width: number; height: number } }
    requestId?: string | null
    userId?: string | null
    workspaceId?: string | null
    route?: string | null
    method?: string | null
    ip?: string | null
    prevHash: string
    thisHash: string
  }
  related?: Array<{
    id: string
    ts: string
    level: string
    source: string
    message: string
  }>
}

export function ErrorDetailScreen() {
  const { id } = useParams({ from: '/errors/$id' })
  const [modalOpen, setModalOpen] = useState(false)
  const q = useQuery({
    queryKey: ['errors-detail', id],
    queryFn: async () => {
      const res = await fetch(`/api/errors/${encodeURIComponent(id)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as DetailResponse
    },
  })

  if (q.isLoading) return <div className="p-6 text-sm">Lade…</div>
  if (q.isError || !q.data?.entry)
    return (
      <div className="p-6 text-sm" style={{ color: 'var(--theme-muted)' }}>
        Eintrag nicht gefunden.
        <Link to="/errors" className="ml-2 underline">
          zurück
        </Link>
      </div>
    )
  const e = q.data.entry
  const related = q.data.related ?? []
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <Link to="/errors" className="text-xs underline opacity-70">
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
        </Link>
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={Bug02Icon} size={18} />
          <h1 className="text-lg font-semibold">{e.level.toUpperCase()}: {e.message}</h1>
        </div>
        <div className="ml-auto">
          <Button onClick={() => setModalOpen(true)}>Als Builder-Brief kopieren</Button>
        </div>
      </header>

      <Section title="Metadata">
        <KV label="ID" value={<code>{e.id}</code>} />
        <KV label="Erste Occurrence" value={new Date(e.ts).toISOString()} />
        {e.lastOccurrenceAt && (
          <KV
            label="Letzte Occurrence"
            value={`${new Date(e.lastOccurrenceAt).toISOString()} — ${e.occurrences ?? 1}×`}
          />
        )}
        <KV label="Source" value={<code>{e.source}</code>} />
        {e.route && <KV label="Route" value={<code>{e.route}</code>} />}
        {e.method && <KV label="Method" value={<code>{e.method}</code>} />}
        {e.userId && <KV label="User" value={<code>{e.userId}</code>} />}
        {e.workspaceId && <KV label="Workspace" value={<code>{e.workspaceId}</code>} />}
        {e.requestId && <KV label="Request-ID" value={<code>{e.requestId}</code>} />}
        {e.ip && <KV label="IP" value={<code>{e.ip}</code>} />}
      </Section>

      {e.stack && (
        <Section title="Stack (redacted)">
          <pre className="overflow-auto text-xs" style={{ color: 'var(--theme-text)' }}>
            {e.stack}
          </pre>
        </Section>
      )}

      {e.context && Object.keys(e.context).length > 0 && (
        <Section title="Context">
          <pre className="overflow-auto text-xs" style={{ color: 'var(--theme-text)' }}>
            {JSON.stringify(e.context, null, 2)}
          </pre>
        </Section>
      )}

      {e.browser && (
        <Section title="Browser">
          {e.browser.userAgent && <KV label="UA" value={<code>{e.browser.userAgent}</code>} />}
          {e.browser.url && <KV label="URL" value={e.browser.url} />}
          {e.browser.viewport && (
            <KV
              label="Viewport"
              value={`${e.browser.viewport.width} × ${e.browser.viewport.height}`}
            />
          )}
        </Section>
      )}

      {related.length > 0 && (
        <Section title={`Related Logs (±5 s, requestId ${e.requestId ?? '—'})`}>
          <div className="flex flex-col gap-1">
            {related.map((r) => (
              <Link
                key={r.id}
                to="/errors/$id"
                params={{ id: r.id }}
                className="grid grid-cols-[120px_64px_80px_1fr] items-center gap-2 rounded px-2 py-1 text-xs hover:underline"
                style={{ color: 'var(--theme-text)' }}
              >
                <span className="font-mono opacity-70">
                  {new Date(r.ts).toISOString().slice(11, 23)}
                </span>
                <span className="font-mono uppercase opacity-80">{r.level}</span>
                <span className="font-mono opacity-60">{r.source}</span>
                <span className="truncate">{r.message}</span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      <BuilderBriefModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        errorIds={[e.id]}
      />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-lg p-4"
      style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)' }}
    >
      <h2 className="mb-3 text-xs font-semibold uppercase opacity-60">{title}</h2>
      <div className="flex flex-col gap-1.5 text-sm">{children}</div>
    </section>
  )
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-3 text-sm">
      <div className="opacity-60">{label}</div>
      <div style={{ color: 'var(--theme-text)' }}>{value}</div>
    </div>
  )
}
