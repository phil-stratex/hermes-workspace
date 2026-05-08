import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Bug02Icon, RefreshIcon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { FilterBar, type FilterState } from './components/filter-bar'
import { HealthBadge } from './components/health-badge'
import { BuilderBriefModal } from './components/builder-brief-modal'

type ListEntry = {
  id: string
  ts: string
  lastOccurrenceAt?: string
  occurrences?: number
  level: string
  source: string
  message: string
  route?: string | null
  userId?: string | null
  workspaceId?: string | null
  requestId?: string | null
}

type ListResponse = {
  ok: boolean
  total: number
  entries: Array<ListEntry>
}

const LEVEL_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  fatal: { bg: '#dc262633', fg: '#ef4444', label: '⛔ FATAL' },
  error: { bg: '#dc262622', fg: '#f87171', label: '❌ error' },
  warn: { bg: '#eab30822', fg: '#fbbf24', label: '⚠ warn' },
  info: { bg: '#3b82f622', fg: '#60a5fa', label: 'ℹ info' },
  debug: { bg: '#88888822', fg: '#aaaaaa', label: '· debug' },
}

function fmt(ts: string): string {
  return new Date(ts).toISOString().slice(11, 19)
}

export function ErrorsScreen() {
  const [filter, setFilter] = useState<FilterState>({
    level: [],
    source: [],
    search: '',
    includeTest: false,
  })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [modalOpen, setModalOpen] = useState(false)

  const params = useMemo(() => {
    const p = new URLSearchParams()
    if (filter.level.length > 0) p.set('level', filter.level.join(','))
    if (filter.source.length > 0) p.set('source', filter.source.join(','))
    if (filter.search.trim()) p.set('search', filter.search.trim())
    if (filter.includeTest) p.set('includeTest', '1')
    p.set('limit', '200')
    return p.toString()
  }, [filter])

  const listQuery = useQuery({
    queryKey: ['errors-list', params],
    queryFn: async () => {
      const res = await fetch(`/api/errors?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as ListResponse
    },
    refetchInterval: 10_000,
    staleTime: 5_000,
  })

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="rounded-2xl border p-2.5"
            style={{
              background: 'var(--theme-card)',
              borderColor: 'var(--theme-border)',
            }}
          >
            <HugeiconsIcon icon={Bug02Icon} size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Error Log</h1>
            <p className="text-xs" style={{ color: 'var(--theme-muted)' }}>
              Stack-weite Fehler-Erfassung mit Live-Tail und Builder-Brief-Export
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HealthBadge />
          <Button
            variant="outline"
            onClick={() => listQuery.refetch()}
            disabled={listQuery.isFetching}
          >
            <HugeiconsIcon icon={RefreshIcon} size={14} />
            <span className="ml-1.5">Refresh</span>
          </Button>
        </div>
      </header>

      <FilterBar state={filter} onChange={setFilter} />

      <div
        className="rounded-lg"
        style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)' }}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-2 text-xs"
          style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-muted)' }}
        >
          <div>
            {listQuery.isLoading
              ? 'Lade…'
              : listQuery.data
                ? `${listQuery.data.entries.length} / ${listQuery.data.total} angezeigt`
                : 'Keine Daten'}
          </div>
          {selected.size > 0 && (
            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--theme-text)' }}>
                {selected.size} ausgewählt
              </span>
              <Button onClick={() => setModalOpen(true)}>
                Als Builder-Brief kopieren
              </Button>
              <Button variant="outline" onClick={() => setSelected(new Set())}>
                Auswahl leeren
              </Button>
            </div>
          )}
        </div>
        <div>
          {listQuery.data?.entries.map((e) => (
            <ErrorRow
              key={e.id}
              entry={e}
              selected={selected.has(e.id)}
              onToggle={() => toggleSelect(e.id)}
            />
          ))}
          {listQuery.data && listQuery.data.entries.length === 0 && (
            <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--theme-muted)' }}>
              Keine Einträge im aktuellen Filter.
            </div>
          )}
        </div>
      </div>

      <BuilderBriefModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        errorIds={[...selected]}
      />
    </div>
  )
}

function ErrorRow({
  entry,
  selected,
  onToggle,
}: {
  entry: ListEntry
  selected: boolean
  onToggle: () => void
}) {
  const badge = LEVEL_BADGE[entry.level] ?? LEVEL_BADGE.info
  const isDedup = (entry.occurrences ?? 1) > 1
  return (
    <div
      className="flex items-start gap-3 border-b px-4 py-3 text-sm last:border-b-0"
      style={{ borderColor: 'var(--theme-border)' }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="mt-1"
      />
      <div className="font-mono text-xs opacity-70" style={{ minWidth: 64 }}>
        {fmt(entry.ts)}
      </div>
      <div
        className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
        style={{ background: badge.bg, color: badge.fg, minWidth: 64, textAlign: 'center' }}
      >
        {badge.label}
      </div>
      <div className="flex-1 overflow-hidden">
        <Link to="/errors/$id" params={{ id: entry.id }} className="block hover:underline">
          <div className="truncate font-medium" style={{ color: 'var(--theme-text)' }}>
            {entry.message}
          </div>
          <div className="truncate text-[11px]" style={{ color: 'var(--theme-muted)' }}>
            <span>source=</span>
            <code>{entry.source}</code>
            {entry.route && (
              <>
                <span className="ml-2">route=</span>
                <code>{entry.route}</code>
              </>
            )}
            {entry.userId && (
              <>
                <span className="ml-2">user=</span>
                <code>{entry.userId}</code>
              </>
            )}
            {entry.workspaceId && (
              <>
                <span className="ml-2">ws=</span>
                <code>{entry.workspaceId}</code>
              </>
            )}
            {isDedup && (
              <span className="ml-2" style={{ color: '#fbbf24' }}>
                ↻ {entry.occurrences}× (last:&nbsp;
                {entry.lastOccurrenceAt ? fmt(entry.lastOccurrenceAt) : '?'})
              </span>
            )}
          </div>
        </Link>
      </div>
    </div>
  )
}
