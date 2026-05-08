import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AlertCircleIcon,
  ConsoleIcon,
  Link01Icon,
  Loading03Icon,
  PlayIcon,
  RefreshIcon,
  RotateClockwiseIcon,
  StopIcon,
} from '@hugeicons/core-free-icons'
import {
  fetchPreviewLogs,
  fetchPreviewStatus,
  runnerQueryKeys,
  startPreview,
  stopPreview,
} from './_runner-api'
import { getDirname } from './_helpers'
import { IframeView } from './iframe-view'
import type { RunnerFramework, RunningPreview } from './_runner-types'
import type { PreviewTab } from '@/stores/preview-panel-store'
import { cn } from '@/lib/utils'

type RunAppTabProps = {
  tab: PreviewTab
}

const FRAMEWORK_LABEL: Record<RunnerFramework, string> = {
  next: 'Next.js',
  vite: 'Vite',
  astro: 'Astro',
  sveltekit: 'SvelteKit',
  cra: 'Create React App',
  static: 'Static site',
  unknown: 'Project',
}

const LOGS_TAIL = 200

/**
 * MVP rule: this component is rendered only when the active tab's basename is
 * `package.json`. We derive the projectDirRelative from the tab path's
 * dirname, e.g. tab.path "myapp/package.json" → projectDir "myapp".
 */
export function RunAppTab({ tab }: RunAppTabProps) {
  const queryClient = useQueryClient()
  const projectDirRelative = useMemo(() => getDirname(tab.path), [tab.path])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [iframeKey, setIframeKey] = useState(0)
  const [localError, setLocalError] = useState<string | null>(null)

  const statusQuery = useQuery({
    queryKey: runnerQueryKeys.status(activeRunId ?? ''),
    queryFn: ({ signal }) => fetchPreviewStatus(activeRunId ?? '', signal),
    enabled: Boolean(activeRunId),
    refetchInterval: (query) => {
      const run = query.state.data
      if (!run) return 2000
      if (run.status === 'installing' || run.status === 'starting') {
        return 2000
      }
      // 'ready' | 'error' | 'stopped' → stop polling.
      return false
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  })

  const run = statusQuery.data ?? null
  const isInFlight =
    run?.status === 'installing' || run?.status === 'starting'

  const logsEnabled = Boolean(activeRunId) && (isInFlight || showLogs)
  const logsQuery = useQuery({
    queryKey: runnerQueryKeys.logs(activeRunId ?? '', LOGS_TAIL),
    queryFn: ({ signal }) =>
      fetchPreviewLogs(activeRunId ?? '', LOGS_TAIL, signal),
    enabled: logsEnabled,
    refetchInterval: logsEnabled ? 2000 : false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })

  const startMutation = useMutation({
    mutationFn: () =>
      startPreview({
        projectDirRelative,
        sessionId: tab.sessionId,
      }),
    onSuccess: (running) => {
      setLocalError(null)
      setActiveRunId(running.runId)
      // Seed the status cache so the polling loop starts from the latest state.
      queryClient.setQueryData(
        runnerQueryKeys.status(running.runId),
        running,
      )
    },
    onError: (error) => {
      setLocalError(
        error instanceof Error ? error.message : 'Failed to start preview',
      )
    },
  })

  const stopMutation = useMutation({
    mutationFn: (runId: string) => stopPreview(runId),
    onSuccess: () => {
      const id = activeRunId
      setActiveRunId(null)
      setShowLogs(false)
      if (id) {
        queryClient.removeQueries({
          queryKey: runnerQueryKeys.status(id),
        })
        queryClient.removeQueries({
          queryKey: runnerQueryKeys.logs(id, LOGS_TAIL),
        })
      }
    },
    onError: (error) => {
      setLocalError(
        error instanceof Error ? error.message : 'Failed to stop preview',
      )
    },
  })

  // If the backend reports 'stopped' on its own (e.g. process exit), drop the
  // active run id so the user sees the idle screen again on next render.
  useEffect(() => {
    if (run?.status === 'stopped') {
      setActiveRunId(null)
    }
  }, [run?.status])

  function handleStart() {
    if (!projectDirRelative) {
      setLocalError(
        'Cannot determine project directory — open a package.json that lives in a subfolder.',
      )
      return
    }
    setLocalError(null)
    startMutation.mutate()
  }

  function handleStop() {
    if (!activeRunId) return
    stopMutation.mutate(activeRunId)
  }

  function handleRestart() {
    if (!activeRunId) return
    stopMutation.mutate(activeRunId, {
      onSuccess: () => {
        startMutation.mutate()
      },
    })
  }

  function handleRefreshIframe() {
    setIframeKey((value) => value + 1)
  }

  // ---- State A: idle (no active run) ------------------------------------
  if (!activeRunId || !run) {
    if (startMutation.isPending) {
      return <RunnerLoadingShell label="Starting preview…" />
    }
    return (
      <IdleState
        projectDirRelative={projectDirRelative}
        onStart={handleStart}
        error={localError}
      />
    )
  }

  // ---- State E: error ---------------------------------------------------
  if (run.status === 'error') {
    return (
      <ErrorState
        run={run}
        logs={logsQuery.data ?? ''}
        onRetry={handleStart}
        onStop={handleStop}
      />
    )
  }

  // ---- State B / C: installing / starting -------------------------------
  if (run.status === 'installing' || run.status === 'starting') {
    return (
      <ProgressState
        run={run}
        logs={logsQuery.data ?? ''}
        onStop={handleStop}
      />
    )
  }

  // ---- State D: ready ---------------------------------------------------
  // run.status === 'ready' (or any other status falls through to ready UI;
  // 'stopped' is handled by the effect above which clears activeRunId).
  return (
    <ReadyState
      key={run.runId}
      iframeKey={iframeKey}
      run={run}
      logs={logsQuery.data ?? ''}
      showLogs={showLogs}
      onToggleLogs={() => setShowLogs((value) => !value)}
      onRefresh={handleRefreshIframe}
      onStop={handleStop}
      onRestart={handleRestart}
      isStopping={stopMutation.isPending}
    />
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function IdleState({
  projectDirRelative,
  onStart,
  error,
}: {
  projectDirRelative: string
  onStart: () => void
  error: string | null
}) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-5 bg-primary-50/40 px-6 py-10">
      <div
        className={cn(
          'flex w-full max-w-md flex-col gap-4 rounded-xl border border-primary-200 bg-white p-5 shadow-sm',
        )}
      >
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-md border border-primary-200 bg-primary-100 text-primary-700">
            <HugeiconsIcon icon={PlayIcon} size={18} strokeWidth={1.5} />
          </span>
          <div className="flex flex-col">
            <h3 className="text-sm font-semibold text-primary-950">
              Run dev server
            </h3>
            <p className="text-xs text-primary-600">
              Start the project's dev server inside the Hermes container.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-1 rounded-md border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-700">
          <span className="font-medium uppercase tracking-wide text-[10px] text-primary-500">
            Project directory
          </span>
          <span className="truncate font-mono text-primary-900">
            {projectDirRelative || '(no subdirectory — refusing to start)'}
          </span>
        </div>
        <p className="text-[11px] text-primary-600">
          Hermes will execute{' '}
          <code className="rounded bg-primary-100 px-1 font-mono text-[10px] text-primary-800">
            pnpm install &amp;&amp; pnpm dev
          </code>{' '}
          (or the framework-specific equivalent) and proxy the running app to
          the iframe below.
        </p>
        <button
          type="button"
          onClick={onStart}
          disabled={!projectDirRelative}
          className={cn(
            'inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary-950 px-3 text-sm font-medium text-primary-50',
            'transition-colors hover:bg-primary-800 disabled:cursor-not-allowed disabled:bg-primary-300',
          )}
        >
          <HugeiconsIcon icon={PlayIcon} size={14} strokeWidth={1.5} />
          Run dev server
        </button>
        {error ? (
          <p className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <HugeiconsIcon
              icon={AlertCircleIcon}
              size={14}
              strokeWidth={1.5}
              className="mt-0.5 shrink-0"
            />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </div>
  )
}

function RunnerLoadingShell({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-primary-50/40 px-6 text-center">
      <span className="flex size-10 items-center justify-center text-primary-500">
        <HugeiconsIcon
          icon={Loading03Icon}
          size={28}
          strokeWidth={1.5}
          className="animate-spin"
        />
      </span>
      <p className="text-sm text-primary-700">{label}</p>
    </div>
  )
}

function ProgressState({
  run,
  logs,
  onStop,
}: {
  run: RunningPreview
  logs: string
  onStop: () => void
}) {
  const isInstalling = run.status === 'installing'
  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-50/40">
      <ProgressHeader run={run} onStop={onStop} />
      <div className="flex flex-1 min-h-0 flex-col gap-3 px-4 pb-4 pt-3">
        <div className="flex items-start gap-3 rounded-lg border border-primary-200 bg-white px-4 py-3 shadow-sm">
          <span className="mt-0.5 flex size-7 items-center justify-center text-primary-500">
            <HugeiconsIcon
              icon={Loading03Icon}
              size={18}
              strokeWidth={1.5}
              className="animate-spin"
            />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium text-primary-950">
              {isInstalling
                ? 'Installing dependencies…'
                : 'Starting dev server…'}
            </span>
            <span className="text-xs text-primary-600">
              {isInstalling
                ? 'This usually takes 30–90 seconds on a fresh install.'
                : `Listening on port ${run.port}.`}
            </span>
          </div>
        </div>
        <LogsPanel logs={logs} className="flex-1 min-h-0" />
      </div>
    </div>
  )
}

function ErrorState({
  run,
  logs,
  onRetry,
  onStop,
}: {
  run: RunningPreview
  logs: string
  onRetry: () => void
  onStop: () => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-50/40">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-primary-200 bg-primary-50/60 px-3">
        <div className="flex items-center gap-2 text-xs text-red-700">
          <HugeiconsIcon icon={AlertCircleIcon} size={14} strokeWidth={1.5} />
          <span className="font-medium">Preview failed</span>
        </div>
        <ToolbarButton
          icon={StopIcon}
          label="Discard"
          onClick={onStop}
        />
      </div>
      <div className="flex flex-1 min-h-0 flex-col gap-3 px-4 pb-4 pt-3">
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <span className="mt-0.5 flex size-7 items-center justify-center text-red-600">
            <HugeiconsIcon
              icon={AlertCircleIcon}
              size={18}
              strokeWidth={1.5}
            />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="text-sm font-medium text-red-800">
              {run.errorMessage ?? 'The dev server reported an error.'}
            </span>
            <div>
              <button
                type="button"
                onClick={onRetry}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md border border-red-300 bg-white px-2 text-xs font-medium text-red-700',
                  'transition-colors hover:bg-red-100',
                )}
              >
                <HugeiconsIcon
                  icon={RotateClockwiseIcon}
                  size={12}
                  strokeWidth={1.5}
                />
                Retry
              </button>
            </div>
          </div>
        </div>
        <LogsPanel logs={logs} className="flex-1 min-h-0" />
      </div>
    </div>
  )
}

function ReadyState({
  iframeKey,
  run,
  logs,
  showLogs,
  onToggleLogs,
  onRefresh,
  onStop,
  onRestart,
  isStopping,
}: {
  iframeKey: number
  run: RunningPreview
  logs: string
  showLogs: boolean
  onToggleLogs: () => void
  onRefresh: () => void
  onStop: () => void
  onRestart: () => void
  isStopping: boolean
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-primary-200 bg-primary-50/60 pl-3 pr-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
            Ready
          </span>
          <span className="truncate text-xs text-primary-700">
            {FRAMEWORK_LABEL[run.framework]} · port {run.port}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ToolbarButton
            icon={RefreshIcon}
            label="Refresh"
            onClick={onRefresh}
          />
          <ToolbarButton
            icon={Link01Icon}
            label="Open"
            href={run.basePath.endsWith('/') ? run.basePath : `${run.basePath}/`}
          />
          <ToolbarButton
            icon={RotateClockwiseIcon}
            label="Restart"
            onClick={onRestart}
            disabled={isStopping}
          />
          <ToolbarButton
            icon={ConsoleIcon}
            label={showLogs ? 'Hide logs' : 'Logs'}
            onClick={onToggleLogs}
            active={showLogs}
          />
          <ToolbarButton
            icon={StopIcon}
            label="Stop"
            onClick={onStop}
            disabled={isStopping}
            tone="danger"
          />
        </div>
      </div>
      <div className="flex flex-1 min-h-0 flex-col">
        <div className={cn('relative min-h-0', showLogs ? 'flex-1' : 'flex-1')}>
          <IframeView mode="live" runId={run.runId} reloadKey={iframeKey} />
        </div>
        {showLogs ? (
          <div className="border-t border-primary-200 bg-primary-50 px-3 py-2">
            <LogsPanel logs={logs} compact />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ProgressHeader({
  run,
  onStop,
}: {
  run: RunningPreview
  onStop: () => void
}) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-primary-200 bg-primary-50/60 pl-3 pr-1">
      <div className="flex min-w-0 items-center gap-2 text-xs text-primary-700">
        <span
          className={cn(
            'rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            run.status === 'installing'
              ? 'border-amber-300 bg-amber-50 text-amber-700'
              : 'border-blue-300 bg-blue-50 text-blue-700',
          )}
        >
          {run.status}
        </span>
        <span className="truncate">
          {FRAMEWORK_LABEL[run.framework]} · {run.projectDirRelative}
        </span>
      </div>
      <ToolbarButton icon={StopIcon} label="Cancel" onClick={onStop} />
    </div>
  )
}

function LogsPanel({
  logs,
  className,
  compact = false,
}: {
  logs: string
  className?: string
  compact?: boolean
}) {
  const trimmed = logs.replace(/\n+$/, '')
  return (
    <div
      className={cn(
        'flex flex-col gap-1 overflow-hidden rounded-md border border-primary-200 bg-primary-950/95 text-primary-50',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-primary-800 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-primary-300">
        <span className="flex items-center gap-1.5">
          <HugeiconsIcon icon={ConsoleIcon} size={12} strokeWidth={1.5} />
          Logs
        </span>
        <span className="font-mono lowercase tracking-normal text-primary-400">
          tail {LOGS_TAIL}
        </span>
      </div>
      <pre
        className={cn(
          'flex-1 min-h-0 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap',
          compact ? 'max-h-44' : '',
        )}
      >
        <code>
          {trimmed.length > 0 ? trimmed : 'Waiting for output…'}
        </code>
      </pre>
    </div>
  )
}

type ToolbarButtonProps = {
  icon: typeof PlayIcon
  label: string
  onClick?: () => void
  href?: string
  disabled?: boolean
  active?: boolean
  tone?: 'default' | 'danger'
}

function ToolbarButton({
  icon,
  label,
  onClick,
  href,
  disabled,
  active,
  tone = 'default',
}: ToolbarButtonProps) {
  const baseClass = cn(
    'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
    active
      ? 'bg-primary-950 text-primary-50'
      : tone === 'danger'
        ? 'text-red-700 hover:bg-red-100'
        : 'text-primary-700 hover:bg-primary-100 hover:text-primary-950',
    disabled ? 'cursor-not-allowed opacity-60 hover:bg-transparent' : '',
  )
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        className={baseClass}
      >
        <HugeiconsIcon icon={icon} size={14} strokeWidth={1.5} />
        {label}
      </a>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={baseClass}
    >
      <HugeiconsIcon icon={icon} size={14} strokeWidth={1.5} />
      {label}
    </button>
  )
}
