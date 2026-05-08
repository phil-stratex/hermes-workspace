import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  PlayIcon,
  StopCircleIcon,
  RefreshIcon,
  CheckmarkCircle02Icon,
  AlertCircleIcon,
} from '@hugeicons/core-free-icons'
import { PredictShell, PhasePlaceholder } from './predict-shell'
import { PlatformFeed } from './components/platform-feed'
import { ActionTicker } from './components/action-ticker'
import { useRunProgress } from './hooks/use-run-progress'
import { predictClient } from '@/server/predict-client'
import { cn } from '@/lib/utils'

// Module-level constant — referencing the same array across renders keeps
// downstream useMemo identities stable when `sim?.config.platforms` is undefined.
const DEFAULT_PLATFORMS: ReadonlyArray<string> = ['plaza']

export function PredictRunScreen({ simulationId }: { simulationId: string }) {
  if (!simulationId || simulationId === 'tbd') {
    return (
      <PredictShell
        step={3}
        title="Predict · Simulation"
        subtitle="Es gibt noch keine Simulation — erst Personas erzeugen."
      >
        <PhasePlaceholder
          phase="Keine Simulation gewählt"
          description="Lade auf der Predict-Startseite Material hoch, baue den Wissensgraph, generiere Personas — und springe von dort hierher."
        />
      </PredictShell>
    )
  }
  return <PredictRunContent simulationId={simulationId} />
}

function PredictRunContent({ simulationId }: { simulationId: string }) {
  const [actionError, setActionError] = useState<string | null>(null)
  const [creatingReport, setCreatingReport] = useState(false)
  const navigate = useNavigate()
  const runHook = useRunProgress(simulationId)

  const simulationQuery = useQuery({
    queryKey: ['predict', 'simulation', simulationId],
    queryFn: () => predictClient.getSimulation(simulationId),
    refetchInterval:
      runHook.state.status === 'completed' ||
      runHook.state.status === 'stopped' ||
      runHook.state.status === 'failed'
        ? false
        : 8_000,
  })

  const runActive =
    runHook.state.status === 'running' || runHook.state.status === 'queued'

  const postsQuery = useQuery({
    queryKey: ['predict', 'posts', simulationId, runHook.state.actionsTotal],
    queryFn: () => predictClient.listSimulationPosts(simulationId, { limit: 200 }),
    refetchInterval: runActive ? 4_000 : false,
    placeholderData: (prev) => prev,
  })

  const statsQuery = useQuery({
    queryKey: ['predict', 'agent-stats', simulationId, runHook.state.actionsTotal],
    queryFn: () => predictClient.listAgentStats(simulationId),
    refetchInterval: runActive ? 8_000 : false,
    placeholderData: (prev) => prev,
  })

  const sim = simulationQuery.data
  const platforms = sim?.config.platforms ?? DEFAULT_PLATFORMS

  const postsByPlatform = useMemo(() => {
    const out: Record<string, typeof postsQuery.data> = {}
    for (const p of platforms) {
      out[p] = (postsQuery.data ?? []).filter((post) => post.platform === p)
    }
    return out
  }, [postsQuery.data, platforms])

  const handleStart = async () => {
    setActionError(null)
    try {
      await predictClient.startSimulation(simulationId)
      runHook.reconnect()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleStop = async () => {
    setActionError(null)
    try {
      await predictClient.stopSimulation(simulationId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const isCompleted = runHook.state.status === 'completed'
  const isFailed = runHook.state.status === 'failed'
  const isStopped = runHook.state.status === 'stopped'
  const reportEligible = isCompleted || isStopped

  const handleGenerateReport = async () => {
    setCreatingReport(true)
    setActionError(null)
    try {
      const created = await predictClient.createReport(simulationId)
      void navigate({
        to: '/predict/$reportId/report',
        params: { reportId: created.report_id },
      })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreatingReport(false)
    }
  }
  const percent = runHook.state.targetRounds
    ? Math.round((runHook.state.currentRound / runHook.state.targetRounds) * 100)
    : 0

  return (
    <PredictShell
      step={3}
      title="Predict · Simulation"
      subtitle={`${simulationId} — Multi-Agent Live-Run`}
      rightSlot={
        <div className="flex items-center gap-2">
          <ConnectionPill connection={runHook.connection} onReconnect={runHook.reconnect} />
          {reportEligible ? (
            <button
              type="button"
              onClick={handleGenerateReport}
              disabled={creatingReport}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--theme-accent)] px-3 py-1.5 text-xs font-semibold text-primary-950 hover:bg-[var(--theme-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creatingReport ? 'Erstelle Report…' : 'Report generieren'}
              <HugeiconsIcon icon={ArrowRight01Icon} size={12} />
            </button>
          ) : null}
        </div>
      }
    >
      {/* Status + controls */}
      <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--theme-muted)]">Run-Status</div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase',
                  isCompleted && 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent)]',
                  isFailed && 'bg-red-500/20 text-red-300',
                  isStopped && 'bg-yellow-500/15 text-yellow-200',
                  runActive && 'bg-yellow-500/15 text-yellow-200',
                  !isCompleted && !isFailed && !runActive && !isStopped && 'bg-[var(--theme-bg)]',
                )}
              >
                {isCompleted ? <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} /> : null}
                {isFailed ? <HugeiconsIcon icon={AlertCircleIcon} size={11} /> : null}
                {runHook.state.status}
              </span>
              <span className="text-xs text-[var(--theme-muted)]">
                Runde {runHook.state.currentRound} / {runHook.state.targetRounds || sim?.config.max_rounds || '?'}
                · {runHook.state.actionsTotal} Aktionen · {runHook.state.postsTotal} Posts
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!runActive ? (
              <button
                type="button"
                onClick={handleStart}
                disabled={!sim || sim.persona_count === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--theme-accent)] px-4 py-2 text-sm font-semibold text-primary-950 hover:bg-[var(--theme-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <HugeiconsIcon icon={PlayIcon} size={14} />
                {isCompleted || isStopped || isFailed ? 'Erneut starten' : 'Simulation starten'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStop}
                disabled={runHook.state.stopRequested}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--theme-border)] px-4 py-2 text-sm font-semibold text-[var(--theme-text)] hover:bg-[var(--theme-bg)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <HugeiconsIcon icon={StopCircleIcon} size={14} />
                {runHook.state.stopRequested ? 'Stop angefordert…' : 'Stoppen'}
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--theme-bg)]">
          <div
            className={cn(
              'h-full transition-all duration-300',
              isFailed ? 'bg-red-500' : 'bg-[var(--theme-accent)]',
            )}
            style={{ width: `${Math.min(100, Math.max(2, percent))}%` }}
          />
        </div>
        {runHook.state.error ? (
          <p className="mt-2 text-xs text-red-300">{runHook.state.error}</p>
        ) : null}
        {actionError ? (
          <p className="mt-2 text-xs text-red-300">{actionError}</p>
        ) : null}
      </section>

      {/* Platform feeds + live ticker */}
      <div className={cn('grid gap-4', platforms.length > 1 ? 'lg:grid-cols-2' : 'lg:grid-cols-1')}>
        {platforms.map((platform) => (
          <PlatformFeed
            key={platform}
            platform={platform}
            posts={postsByPlatform[platform] ?? []}
            liveActions={runHook.state.perPlatformActions[platform] ?? 0}
            emptyHint={
              runActive
                ? `Personas posten gleich auf ${platform === 'plaza' ? 'der Info-Plaza' : 'der Topic-Community'}.`
                : 'Starte die Simulation um die ersten Posts zu sehen.'
            }
          />
        ))}
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Live-Aktionen</h3>
        <ActionTicker entries={runHook.state.tickers} />
      </section>

      {statsQuery.data && statsQuery.data.length > 0 ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Agent-Stats</h3>
          <div className="overflow-x-auto rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)]">
            <table className="w-full text-xs">
              <thead className="bg-[var(--theme-bg)] text-left text-[var(--theme-muted)]">
                <tr>
                  <th className="px-3 py-2">Persona</th>
                  <th className="px-3 py-2">Posts</th>
                  <th className="px-3 py-2">Replies</th>
                  <th className="px-3 py-2">Likes geg.</th>
                  <th className="px-3 py-2">Likes erh.</th>
                  <th className="px-3 py-2">Reposts</th>
                </tr>
              </thead>
              <tbody>
                {statsQuery.data.map((row) => (
                  <tr key={row.persona_id} className="border-t border-[var(--theme-border)]">
                    <td className="px-3 py-2 font-semibold">{row.persona_name}</td>
                    <td className="px-3 py-2">{row.posts}</td>
                    <td className="px-3 py-2">{row.replies}</td>
                    <td className="px-3 py-2">{row.likes_given}</td>
                    <td className="px-3 py-2">{row.likes_received}</td>
                    <td className="px-3 py-2">{row.reposts_received}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
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
