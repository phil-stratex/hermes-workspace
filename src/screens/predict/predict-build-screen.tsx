import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  RefreshIcon,
  CheckmarkCircle02Icon,
  AlertCircleIcon,
} from '@hugeicons/core-free-icons'
import { PhasePlaceholder, PredictShell } from './predict-shell'
import { BuildProgress } from './components/build-progress'
import {
  KnowledgeGraphPanel,
  type GraphSelection,
} from './components/knowledge-graph-panel'
import { EnvSetupPanel } from './components/env-setup-panel'
import { PersonaCard, type PersonaCardData } from './components/persona-card'
import { useBuildProgress } from './hooks/use-build-progress'
import { usePrepareProgress } from './hooks/use-prepare-progress'
import { predictClient, type SimulationConfig } from '@/server/predict-client'
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
  const buildHook = useBuildProgress(projectId)

  const projectQuery = useQuery({
    queryKey: ['predict', 'project', projectId],
    queryFn: () => predictClient.getProject(projectId),
    refetchInterval:
      buildHook.state.status === 'completed' || buildHook.state.status === 'failed' ? false : 8_000,
  })

  const graphQuery = useQuery({
    // Stable key — `refetchInterval` already drives polling; including totals
    // here invalidated the cache on every chunk_done event and caused
    // refetch-loops, plus the cache stayed unstable post-completion.
    queryKey: ['predict', 'graph', projectId],
    queryFn: () => predictClient.getProjectGraph(projectId, 200),
    refetchInterval:
      buildHook.state.status === 'completed' || buildHook.state.status === 'failed' ? false : 6_000,
    placeholderData: (prev) => prev,
  })

  const [selection, setSelection] = useState<GraphSelection>(null)
  useEffect(() => {
    setSelection(null)
  }, [projectId])

  const project = projectQuery.data
  const isCompleted = buildHook.state.status === 'completed'

  return (
    <PredictShell
      step={1}
      title="Predict · Build"
      subtitle={`${projectId} — Wissensgraph + Persona-Vorbereitung`}
      rightSlot={
        <ConnectionPill connection={buildHook.connection} onReconnect={buildHook.reconnect} />
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <KnowledgeGraphPanel
          nodes={graphQuery.data?.nodes ?? []}
          edges={graphQuery.data?.edges ?? []}
          selection={selection}
          onSelect={setSelection}
          emptyHint={
            buildHook.state.status === 'queued'
              ? 'Build wird gleich gestartet — die ersten Knoten sind in 30–60s da.'
              : 'Build läuft — Knoten erscheinen, sobald die LLM-Extraktion fortschreitet.'
          }
        />
        <div className="space-y-4">
          <BuildProgress state={buildHook.state} />
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
                      {doc.char_count.toLocaleString()} chars{doc.truncated ? ' · trunc' : ''}
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

      {isCompleted ? <Step2Section projectId={projectId} /> : null}
    </PredictShell>
  )
}

function Step2Section({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const [simulationId, setSimulationId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const prepareHook = usePrepareProgress(simulationId)

  const simulationQuery = useQuery({
    queryKey: ['predict', 'simulation', simulationId],
    queryFn: () =>
      simulationId ? predictClient.getSimulation(simulationId) : Promise.resolve(null),
    enabled: !!simulationId,
    refetchInterval:
      prepareHook.state.status === 'completed' || prepareHook.state.status === 'failed' ? false : 6_000,
  })

  const personasQuery = useQuery({
    queryKey: ['predict', 'personas', simulationId],
    queryFn: () => (simulationId ? predictClient.listPersonas(simulationId) : Promise.resolve([])),
    enabled: !!simulationId,
    refetchInterval:
      prepareHook.state.status === 'completed' || prepareHook.state.status === 'failed' ? false : 6_000,
  })

  const handleStart = async (config: SimulationConfig) => {
    setSubmitting(true)
    setCreateError(null)
    try {
      const created = await predictClient.createSimulation(projectId, config)
      setSimulationId(created.simulation_id)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  // Merge live-streamed personas with the persisted list, dedup by id.
  const persistedPersonas = personasQuery.data ?? []
  const liveById = new Map(prepareHook.state.personas.map((p) => [p.id, p]))
  const mergedById = new Map<string, PersonaCardData>()
  for (const p of persistedPersonas) {
    mergedById.set(p.id, {
      id: p.id,
      name: p.name,
      role: p.role,
      background: p.background,
      bio: p.bio,
      style: p.style,
      seedName: liveById.get(p.id)?.seedName ?? null,
      seedType: liveById.get(p.id)?.seedType ?? null,
    })
  }
  for (const p of prepareHook.state.personas) {
    if (!mergedById.has(p.id)) {
      mergedById.set(p.id, {
        id: p.id,
        name: p.name,
        role: p.role,
        background: p.background,
        bio: p.bio,
        style: p.style,
        seedName: p.seedName,
        seedType: p.seedType,
      })
    }
  }
  const personas = [...mergedById.values()]

  const isPreparing = prepareHook.state.status === 'running' || prepareHook.state.status === 'queued'
  const isReady = prepareHook.state.status === 'completed' && personas.length > 0
  const isFailed = prepareHook.state.status === 'failed'
  const targetCount = prepareHook.state.targetCount || simulationQuery.data?.config.num_agents || 0
  const percent = Math.round(prepareHook.state.progress * 100)

  return (
    <section className="mt-2 space-y-4 border-t border-[var(--theme-border)] pt-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Schritt 2 — Personas</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Ziehe aus dem Wissensgraph eine Population grounded Agents.
          </p>
        </div>
        {isReady ? (
          <button
            type="button"
            onClick={() =>
              simulationId &&
              void navigate({
                to: '/predict/$simulationId/run',
                params: { simulationId },
              })
            }
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--theme-accent)] px-4 py-2 text-sm font-semibold text-primary-950 hover:bg-[var(--theme-accent-strong)]"
          >
            Weiter zu Phase 3
            <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
          </button>
        ) : null}
      </div>

      {!simulationId ? (
        <>
          <EnvSetupPanel busy={submitting} onStart={handleStart} />
          {createError ? (
            <div className="rounded-xl border border-red-500 bg-red-500/10 p-3 text-xs text-red-200">
              {createError}
            </div>
          ) : null}
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
            <div>
              <div className="text-xs text-[var(--theme-muted)]">Simulation-ID</div>
              <div className="font-mono text-sm">{simulationId}</div>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase',
                  isReady && 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent)]',
                  isFailed && 'bg-red-500/20 text-red-300',
                  isPreparing && 'bg-yellow-500/15 text-yellow-200',
                )}
              >
                {isReady ? (
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} />
                ) : isFailed ? (
                  <HugeiconsIcon icon={AlertCircleIcon} size={11} />
                ) : null}
                {prepareHook.state.status}
              </span>
              <button
                type="button"
                onClick={prepareHook.reset}
                title="Reconnect SSE"
                className="rounded-full border border-[var(--theme-border)] p-2 text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
                aria-label="Reconnect"
              >
                <HugeiconsIcon icon={RefreshIcon} size={11} />
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
            <div className="mb-2 flex items-center justify-between text-xs text-[var(--theme-muted)]">
              <span>
                {personas.length} / {targetCount || '?'} Personas
                {prepareHook.state.failedCount > 0
                  ? ` · ${prepareHook.state.failedCount} fehlgeschlagen`
                  : ''}
              </span>
              <span>{percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--theme-bg)]">
              <div
                className={cn(
                  'h-full transition-all duration-300',
                  isFailed ? 'bg-red-500' : 'bg-[var(--theme-accent)]',
                )}
                style={{ width: `${Math.min(100, Math.max(2, percent))}%` }}
              />
            </div>
            {prepareHook.state.error ? (
              <p className="mt-2 text-xs text-red-300">{prepareHook.state.error}</p>
            ) : null}
            {prepareHook.state.lastFailureSeed && !prepareHook.state.error ? (
              <p className="mt-2 text-[11px] text-yellow-200">
                Letzter Fail: Seed „{prepareHook.state.lastFailureSeed}“
              </p>
            ) : null}
          </div>

          {personas.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--theme-border)] bg-[var(--theme-card)] p-8 text-center text-xs text-[var(--theme-muted)]">
              Personas erscheinen sobald die LLM-Calls zurückkommen — typischerweise eine alle 5–15 s.
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {personas.map((p) => (
                <li key={p.id}>
                  <PersonaCard persona={p} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
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
