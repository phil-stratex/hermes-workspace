import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle02Icon, AlertCircleIcon } from '@hugeicons/core-free-icons'
import type { BuildEvent } from '@/server/predict-client'
import { cn } from '@/lib/utils'

const PHASE_LABELS = ['Ontologie', 'Wissensgraph', 'Fertig'] as const

export type BuildState = {
  phase: number
  progress: number
  status: 'queued' | 'running' | 'completed' | 'failed' | string
  error: string | null
  ontology: {
    domain: string
    entityTypes: Array<string>
    relationTypes: Array<string>
    notes: string
  } | null
  nodesTotal: number
  edgesTotal: number
  lastChunkDoc: string | null
  recentEvents: Array<BuildEvent>
}

export const initialBuildState: BuildState = {
  phase: 0,
  progress: 0,
  status: 'queued',
  error: null,
  ontology: null,
  nodesTotal: 0,
  edgesTotal: 0,
  lastChunkDoc: null,
  recentEvents: [],
}

export function reduceBuildEvent(state: BuildState, event: BuildEvent): BuildState {
  const recentEvents = [...state.recentEvents.slice(-19), event]
  switch (event.type) {
    case 'snapshot':
      return {
        ...state,
        phase: event.phase,
        progress: event.progress,
        status: event.status,
        error: event.error ?? null,
        recentEvents,
      }
    case 'phase':
      return { ...state, phase: event.phase, recentEvents }
    case 'ontology':
      return {
        ...state,
        ontology: {
          domain: event.domain,
          entityTypes: event.entity_types,
          relationTypes: event.relation_types,
          notes: event.notes,
        },
        recentEvents,
      }
    case 'chunk_done':
      return {
        ...state,
        progress: event.progress,
        nodesTotal: event.nodes_total,
        edgesTotal: event.edges_total,
        lastChunkDoc: event.doc,
        recentEvents,
      }
    case 'chunk_failed':
      return { ...state, lastChunkDoc: event.doc, recentEvents }
    case 'done':
      return {
        ...state,
        phase: 2,
        progress: 1,
        status: 'completed',
        recentEvents,
      }
    case 'failed':
      return {
        ...state,
        status: 'failed',
        error: event.error,
        recentEvents,
      }
    case 'end':
      return state
    default:
      return state
  }
}

export function BuildProgress({ state }: { state: BuildState }) {
  const isFailed = state.status === 'failed'
  const isDone = state.status === 'completed'
  const percent = Math.round(state.progress * 100)

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Build-Fortschritt</div>
        <div
          className={cn(
            'rounded-full px-3 py-1 text-[10px] font-semibold uppercase',
            isFailed && 'bg-red-500/20 text-red-300',
            isDone && 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent)]',
            !isFailed && !isDone && 'bg-yellow-500/15 text-yellow-200',
          )}
        >
          {state.status}
        </div>
      </div>

      <ol className="grid grid-cols-3 gap-2 text-center">
        {PHASE_LABELS.map((label, idx) => {
          const isActive = state.phase === idx && !isDone && !isFailed
          const isComplete = isDone || state.phase > idx
          return (
            <li
              key={label}
              className={cn(
                'rounded-xl border px-3 py-2 text-xs',
                isComplete && 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)]',
                isActive && 'border-yellow-500 bg-yellow-500/10',
                !isComplete && !isActive && 'border-[var(--theme-border)] opacity-60',
              )}
            >
              <div className="text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">
                Phase {idx + 1}
              </div>
              <div className="font-semibold">{label}</div>
            </li>
          )
        })}
      </ol>

      <div>
        <div className="mb-1 flex justify-between text-xs text-[var(--theme-muted)]">
          <span>{state.lastChunkDoc ? `Aktuelles Dokument: ${state.lastChunkDoc}` : 'Bereit zum Start'}</span>
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
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-3">
          <div className="text-[10px] uppercase text-[var(--theme-muted)]">Knoten</div>
          <div className="text-lg font-semibold">{state.nodesTotal}</div>
        </div>
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-3">
          <div className="text-[10px] uppercase text-[var(--theme-muted)]">Kanten</div>
          <div className="text-lg font-semibold">{state.edgesTotal}</div>
        </div>
      </div>

      {state.ontology ? (
        <details className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-3 text-xs" open>
          <summary className="cursor-pointer font-semibold">
            Ontologie · {state.ontology.domain}
          </summary>
          <div className="mt-2 space-y-2">
            <div>
              <div className="text-[10px] uppercase text-[var(--theme-muted)]">Entity-Typen</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {state.ontology.entityTypes.map((et) => (
                  <span
                    key={et}
                    className="rounded-full border border-[var(--theme-border)] px-2 py-0.5"
                  >
                    {et}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-[var(--theme-muted)]">Relations-Typen</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {state.ontology.relationTypes.map((rt) => (
                  <span
                    key={rt}
                    className="rounded-full border border-[var(--theme-border)] px-2 py-0.5"
                  >
                    {rt}
                  </span>
                ))}
              </div>
            </div>
            {state.ontology.notes ? (
              <div className="text-[var(--theme-muted)]">{state.ontology.notes}</div>
            ) : null}
          </div>
        </details>
      ) : null}

      {state.error ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-500 bg-red-500/10 p-3 text-xs text-red-200">
          <HugeiconsIcon icon={AlertCircleIcon} size={14} />
          <span>{state.error}</span>
        </div>
      ) : null}

      {isDone ? (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] p-3 text-xs">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} />
          <span>Wissensgraph fertig. Im nächsten Schritt: Persona-Generierung.</span>
        </div>
      ) : null}
    </div>
  )
}
