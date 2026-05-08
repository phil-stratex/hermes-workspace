import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { PhasePlaceholder, PredictShell } from './predict-shell'
import { predictClient, type PredictHealth } from '@/server/predict-client'
import { cn } from '@/lib/utils'

export function PredictHomeScreen() {
  const [health, setHealth] = useState<PredictHealth | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [healthLoading, setHealthLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setHealthLoading(true)
    predictClient
      .health()
      .then((res) => {
        if (cancelled) return
        setHealth(res)
        setHealthError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setHealth(null)
        setHealthError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setHealthLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <PredictShell
      step={null}
      title="Predict"
      subtitle="Multi-Agent-Vorhersage-Engine — Upload, Graph, Simulation, Report, Interaktion."
      rightSlot={<HealthBadge health={health} error={healthError} loading={healthLoading} />}
    >
      <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-6">
        <h2 className="text-base font-semibold">Neue Vorhersage starten</h2>
        <p className="mt-1 text-sm text-[var(--theme-muted)]">
          Lade Seed-Material (PDF, Markdown, Text) und beschreibe, was du
          vorhersagen möchtest. MiroFish-Spec, neu im Stratex-Stack.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Link
            to="/predict/$projectId/build"
            params={{ projectId: 'new' }}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--theme-accent)] px-4 py-2 text-sm font-semibold text-primary-950 hover:bg-[var(--theme-accent-strong)]"
          >
            Engine starten
            <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
          </Link>
        </div>
      </div>

      <PhasePlaceholder
        phase="Phase 0 — Foundation"
        description="Diese Seite ist das Skelett. In den nächsten Phasen kommen Upload-Dropzone, Knowledge-Graph-Live-Build, Persona-Generation, Dual-Platform-Simulation, Report-Streaming und Agent-Interaction dazu."
      />

      <section>
        <h3 className="mb-3 text-sm font-semibold">Verlauf</h3>
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 text-xs text-[var(--theme-muted)]">
          Noch keine Vorhersagen — die History-Datenbank wird in Phase 1 mit
          dem Backend verbunden.
        </div>
      </section>
    </PredictShell>
  )
}

function HealthBadge({
  health,
  error,
  loading,
}: {
  health: PredictHealth | null
  error: string | null
  loading: boolean
}) {
  let label = 'Backend prüfen…'
  let tone: 'idle' | 'ok' | 'degraded' | 'error' = 'idle'
  let detail: string | null = null

  if (loading) {
    tone = 'idle'
  } else if (error) {
    label = 'Backend nicht erreichbar'
    tone = 'error'
    detail = error
  } else if (health) {
    label = health.status === 'ok' ? `Backend OK · v${health.version}` : 'Backend degraded'
    tone = health.status === 'ok' ? 'ok' : 'degraded'
    const downstream = health.dependencies.filter((d) => !d.ok).map((d) => d.name)
    if (downstream.length > 0) detail = `down: ${downstream.join(', ')}`
  }

  return (
    <div
      title={detail ?? undefined}
      className={cn(
        'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs',
        tone === 'ok' && 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)]',
        tone === 'degraded' && 'border-yellow-500 bg-yellow-500/10 text-yellow-200',
        tone === 'error' && 'border-red-500 bg-red-500/10 text-red-300',
        tone === 'idle' && 'border-[var(--theme-border)] text-[var(--theme-muted)]',
      )}
    >
      <span
        className={cn(
          'h-2 w-2 rounded-full',
          tone === 'ok' && 'bg-[var(--theme-accent)]',
          tone === 'degraded' && 'bg-yellow-400',
          tone === 'error' && 'bg-red-400',
          tone === 'idle' && 'bg-[var(--theme-muted)]',
        )}
      />
      <span>{label}</span>
    </div>
  )
}
