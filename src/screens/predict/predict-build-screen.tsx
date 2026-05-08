import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, RefreshIcon } from '@hugeicons/core-free-icons'
import { PhasePlaceholder, PredictShell } from './predict-shell'
import { BuildProgress } from './components/build-progress'
import {
  KnowledgeGraphPanel,
  type GraphSelection,
} from './components/knowledge-graph-panel'
import { useBuildProgress } from './hooks/use-build-progress'
import { predictClient } from '@/server/predict-client'
import { cn } from '@/lib/utils'

export function PredictBuildScreen({ projectId }: { projectId: string }) {
  const isUnresolved = projectId === 'new' || !projectId

  if (isUnresolved) {
    return (
      <PredictShell
        step={1}
        title="Predict · Build"
        subtitle="Erst muss ein Projekt erstellt werden — zurück zur Startseite und Datei + Prompt absenden."
      >
        <PhasePlaceholder
          phase="Kein Projekt ausgewählt"
          description="Lade auf der Predict-Startseite Seed-Material hoch und starte die Engine. Du wirst danach automatisch hierher weitergeleitet."
        />
      </PredictShell>
    )
  }

  return <PredictBuildContent projectId={projectId} />
}

function PredictBuildContent({ projectId }: { projectId: string }) {
  const { state, connection, reconnect } = useBuildProgress(projectId)

  const projectQuery = useQuery({
    queryKey: ['predict', 'project', projectId],
    queryFn: () => predictClient.getProject(projectId),
    refetchInterval: state.status === 'completed' || state.status === 'failed' ? false : 8_000,
  })

  const graphQuery = useQuery({
    queryKey: ['predict', 'graph', projectId, state.nodesTotal, state.edgesTotal],
    queryFn: () => predictClient.getProjectGraph(projectId, 200),
    refetchInterval: state.status === 'completed' || state.status === 'failed' ? false : 6_000,
    placeholderData: (previous) => previous,
  })

  const [selection, setSelection] = useState<GraphSelection>(null)

  useEffect(() => {
    setSelection(null)
  }, [projectId])

  const project = projectQuery.data
  const isCompleted = state.status === 'completed'

  return (
    <PredictShell
      step={1}
      title="Predict · Build"
      subtitle={`${projectId} — Wissensgraph + Persona-Vorbereitung`}
      rightSlot={
        <div className="flex items-center gap-2">
          <ConnectionPill connection={connection} onReconnect={reconnect} />
          {isCompleted ? (
            <Link
              to="/predict/$simulationId/run"
              params={{ simulationId: 'tbd' }}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--theme-accent)] px-3 py-1.5 text-xs font-semibold text-primary-950 hover:bg-[var(--theme-accent-strong)]"
            >
              Weiter zu Phase 2
              <HugeiconsIcon icon={ArrowRight01Icon} size={12} />
            </Link>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <KnowledgeGraphPanel
          nodes={graphQuery.data?.nodes ?? []}
          edges={graphQuery.data?.edges ?? []}
          selection={selection}
          onSelect={setSelection}
          emptyHint={
            state.status === 'queued'
              ? 'Build wird gleich gestartet — die ersten Knoten sind in 30–60s da.'
              : 'Build läuft — Knoten erscheinen, sobald die LLM-Extraktion fortschreitet.'
          }
        />
        <div className="space-y-4">
          <BuildProgress state={state} />

          {project ? (
            <details className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 text-xs" open>
              <summary className="cursor-pointer text-sm font-semibold">Quelldokumente</summary>
              <ul className="mt-2 space-y-1.5">
                {project.documents.map((doc) => (
                  <li key={doc.id} className="flex items-start justify-between gap-2">
                    <span className="truncate" title={doc.name}>
                      {doc.name}
                    </span>
                    <span className="shrink-0 text-[var(--theme-muted)]">
                      {doc.char_count.toLocaleString()} chars
                      {doc.truncated ? ' · trunc' : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 border-t border-[var(--theme-border)] pt-2 text-[var(--theme-muted)]">
                Prompt: {project.prompt || '—'}
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </PredictShell>
  )
}

function ConnectionPill({
  connection,
  onReconnect,
}: {
  connection: 'idle' | 'connecting' | 'open' | 'closed' | 'error'
  onReconnect: () => void
}) {
  const labels: Record<string, string> = {
    idle: 'Verbindung idle',
    connecting: 'Verbindung wird aufgebaut…',
    open: 'Live verbunden',
    closed: 'Verbindung geschlossen',
    error: 'Verbindungsproblem',
  }
  return (
    <button
      type="button"
      onClick={onReconnect}
      title="Reconnect"
      className={cn(
        'flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px]',
        connection === 'open' && 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)]',
        connection === 'error' && 'border-yellow-500 bg-yellow-500/10 text-yellow-200',
        connection === 'closed' && 'border-red-500 bg-red-500/10 text-red-200',
        (connection === 'idle' || connection === 'connecting') &&
          'border-[var(--theme-border)] text-[var(--theme-muted)]',
      )}
    >
      <HugeiconsIcon icon={RefreshIcon} size={11} />
      <span>{labels[connection]}</span>
    </button>
  )
}
