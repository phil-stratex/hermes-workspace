import { useEffect, useMemo, useState } from 'react'
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
import { ReportSectionCard } from './components/report-section-card'
import { useReportProgress, type ReportSectionState } from './hooks/use-report-progress'
import { predictClient } from '@/server/predict-client'
import { cn } from '@/lib/utils'

export function PredictReportScreen({ reportId }: { reportId: string }) {
  if (!reportId || reportId === 'tbd') {
    return (
      <PredictShell
        step={4}
        title="Predict · Report"
        subtitle="Es gibt noch keinen Report — erst die Simulation abschließen."
      >
        <PhasePlaceholder
          phase="Kein Report ausgewählt"
          description="Beende auf der Run-Page eine Simulation und klicke 'Weiter zu Phase 4', um den Report-Agent zu starten."
        />
      </PredictShell>
    )
  }
  return <PredictReportContent reportId={reportId} />
}

function PredictReportContent({ reportId }: { reportId: string }) {
  const navigate = useNavigate()
  const reportHook = useReportProgress(reportId)

  const reportQuery = useQuery({
    queryKey: ['predict', 'report', reportId, reportHook.state.completedSections, reportHook.state.failedSections],
    queryFn: () => predictClient.getReport(reportId),
    refetchInterval:
      reportHook.state.status === 'completed' || reportHook.state.status === 'failed' ? false : 5_000,
  })

  // Merge SSE-streamed sections with the canonical persisted list.
  const mergedSections = useMemo<Array<ReportSectionState>>(() => {
    const persisted = reportQuery.data?.sections ?? []
    const live = reportHook.state.sections
    const map = new Map<string, ReportSectionState>()
    for (const s of persisted) {
      map.set(s.slug, {
        slug: s.slug,
        title: s.title,
        ordering: s.ordering,
        status: (s.status as ReportSectionState['status']) ?? 'pending',
        content: s.content,
        error: s.error ?? null,
      })
    }
    for (const s of live) {
      const existing = map.get(s.slug)
      if (!existing || (s.status === 'running' && existing.status === 'pending')) {
        map.set(s.slug, s)
      } else if (s.status === 'completed' && s.content && !existing.content) {
        map.set(s.slug, { ...existing, status: 'completed', content: s.content })
      } else if (s.status === 'failed') {
        map.set(s.slug, { ...existing, status: 'failed', error: s.error })
      }
    }
    return [...map.values()].sort((a, b) => a.ordering - b.ordering)
  }, [reportQuery.data, reportHook.state.sections])

  const total = reportQuery.data?.sections.length || reportHook.state.totalSections || mergedSections.length || 0
  const completed = mergedSections.filter((s) => s.status === 'completed').length
  const isCompleted = reportHook.state.status === 'completed' || reportQuery.data?.status === 'completed'
  const isFailed = reportHook.state.status === 'failed' || reportQuery.data?.status === 'failed'
  const percent = total > 0 ? Math.round((completed / total) * 100) : Math.round((reportQuery.data?.progress ?? 0) * 100)

  const simulationId = reportQuery.data?.simulation_id

  return (
    <PredictShell
      step={4}
      title="Predict · Report"
      subtitle={`${reportId}${simulationId ? ` · sim ${simulationId}` : ''} — ReportAgent-Analyse`}
      rightSlot={
        <div className="flex items-center gap-2">
          <ConnectionPill connection={reportHook.connection} onReconnect={reportHook.reconnect} />
          {isCompleted && reportId ? (
            <button
              type="button"
              onClick={() =>
                void navigate({
                  to: '/predict/$reportId/chat',
                  params: { reportId },
                })
              }
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--theme-accent)] px-3 py-1.5 text-xs font-semibold text-primary-950 hover:bg-[var(--theme-accent-strong)]"
            >
              Weiter zu Phase 5
              <HugeiconsIcon icon={ArrowRight01Icon} size={12} />
            </button>
          ) : null}
        </div>
      }
    >
      <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Report-Generation</h2>
            <div className="text-xs text-[var(--theme-muted)]">
              {completed} / {total || '?'} Sektionen abgeschlossen{reportHook.state.failedSections > 0 ? ` · ${reportHook.state.failedSections} fehlgeschlagen` : ''}
            </div>
          </div>
          <span
            className={cn(
              'flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase',
              isCompleted && 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent)]',
              isFailed && 'bg-red-500/20 text-red-300',
              !isCompleted && !isFailed && 'bg-yellow-500/15 text-yellow-200',
            )}
          >
            {isCompleted ? <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} /> : null}
            {isFailed ? <HugeiconsIcon icon={AlertCircleIcon} size={11} /> : null}
            {reportHook.state.status !== 'idle'
              ? reportHook.state.status
              : reportQuery.data?.status ?? '…'}
          </span>
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
        {reportQuery.data?.error ? (
          <p className="mt-2 text-xs text-red-300">{reportQuery.data.error}</p>
        ) : reportHook.state.error ? (
          <p className="mt-2 text-xs text-red-300">{reportHook.state.error}</p>
        ) : null}
      </section>

      {mergedSections.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--theme-border)] bg-[var(--theme-card)] p-8 text-center text-xs text-[var(--theme-muted)]">
          Sektionen erscheinen sobald der ReportAgent die ersten Aggregate gerechnet hat — typischerweise innerhalb 30–60 s.
        </div>
      ) : (
        <ul className="space-y-3">
          {mergedSections.map((section) => (
            <li key={section.slug}>
              <ReportSectionCard section={section} />
            </li>
          ))}
        </ul>
      )}
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
