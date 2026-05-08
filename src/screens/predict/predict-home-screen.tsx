import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, RocketIcon, RefreshIcon, Clock01Icon } from '@hugeicons/core-free-icons'
import { PredictShell } from './predict-shell'
import { UploadDropzone } from './components/upload-dropzone'
import {
  predictClient,
  type PredictHealth,
  type ProjectSummary,
} from '@/server/predict-client'
import { usePredictStore } from '@/stores/predict-store'
import { cn } from '@/lib/utils'

export function PredictHomeScreen() {
  const [health, setHealth] = useState<PredictHealth | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [healthLoading, setHealthLoading] = useState(true)
  const [files, setFiles] = useState<Array<File>>([])
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const navigate = useNavigate()
  const setPendingUpload = usePredictStore((s) => s.setPendingUpload)

  // Server-driven recent projects (replaces the prior client-only zustand cache).
  const projectsQuery = useQuery({
    queryKey: ['predict', 'projects-list'],
    queryFn: () => predictClient.listProjects(20),
    refetchInterval: 15_000,
    enabled: !healthError,
  })
  const recentProjects = projectsQuery.data ?? []
  const inFlightProject = recentProjects.find(
    (p) => p.build_task && (p.build_task.status === 'queued' || p.build_task.status === 'running'),
  )

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

  const canSubmit = files.length > 0 && prompt.trim().length > 0 && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      // Cache so the build screen can render before the POST resolves.
      setPendingUpload({ files, prompt })
      const created = await predictClient.createProjectMultipart(files, prompt.trim())
      setPendingUpload(null)
      // Optimistically refresh history so the new project shows up immediately.
      void projectsQuery.refetch()
      void navigate({
        to: '/predict/$projectId/build',
        params: { projectId: created.project_id },
      })
    } catch (err) {
      setPendingUpload(null)
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PredictShell
      step={null}
      title="Predict"
      subtitle="Multi-Agent-Vorhersage-Engine — Upload, Graph, Simulation, Report, Interaktion."
      rightSlot={<HealthBadge health={health} error={healthError} loading={healthLoading} />}
    >
      <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-6">
        <h2 className="text-base font-semibold">Neue Vorhersage starten</h2>
        <p className="mt-1 text-sm text-[var(--theme-muted)]">
          Lade Seed-Material (PDF, Markdown, Text) und beschreibe, was du
          vorhersagen möchtest. Im nächsten Schritt baut das System einen
          Wissensgraph und generiert daraus die Persona-Population.
        </p>
        <div className="mt-5 space-y-4">
          <UploadDropzone files={files} onChange={setFiles} disabled={submitting} />
          <div>
            <label htmlFor="predict-prompt" className="text-xs font-semibold text-[var(--theme-muted)]">
              Vorhersage-Frage
            </label>
            <textarea
              id="predict-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={submitting}
              placeholder="Beispiel: Wie wird die Stadt auf das neue Klimaschutzgesetz reagieren — welche Stakeholder werden Widerstand leisten, welche nicht?"
              rows={3}
              className="mt-1 w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-3 text-sm placeholder:text-[var(--theme-muted)] focus:border-[var(--theme-accent)] focus:outline-none disabled:opacity-60"
            />
          </div>
          {submitError ? (
            <div className="rounded-xl border border-red-500 bg-red-500/10 p-3 text-xs text-red-200">
              {submitError}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-[var(--theme-muted)]">
              {files.length} {files.length === 1 ? 'Datei' : 'Dateien'} ·{' '}
              {prompt.trim().length} Zeichen Prompt
            </div>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--theme-accent)] px-4 py-2 text-sm font-semibold text-primary-950 hover:bg-[var(--theme-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <HugeiconsIcon icon={RocketIcon} size={14} />
              {submitting ? 'Starte Engine…' : 'Engine starten'}
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
            </button>
          </div>
        </div>
      </section>

      {inFlightProject ? (
        <section className="rounded-2xl border-2 border-yellow-500/40 bg-yellow-500/5 p-4">
          <div className="flex items-start gap-3">
            <HugeiconsIcon icon={Clock01Icon} size={18} />
            <div className="flex-1">
              <div className="text-sm font-semibold">Build läuft im Hintergrund</div>
              <div className="text-xs text-[var(--theme-muted)] mt-1">
                Projekt <code>{inFlightProject.project_id.slice(0, 16)}</code> ·
                {' '}Phase {inFlightProject.build_task?.phase} ·{' '}
                {Math.round((inFlightProject.build_task?.progress ?? 0) * 100)}%
              </div>
            </div>
            <Link
              to="/predict/$projectId/build"
              params={{ projectId: inFlightProject.project_id }}
              className="rounded-lg bg-[var(--theme-accent)] px-3 py-1.5 text-xs font-semibold text-primary-950"
            >
              Fortsetzen
            </Link>
          </div>
        </section>
      ) : null}

      <section>
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Verlauf</h3>
          <button
            type="button"
            onClick={() => void projectsQuery.refetch()}
            disabled={projectsQuery.isFetching}
            className="flex items-center gap-1 rounded-full border border-[var(--theme-border)] px-2 py-1 text-[10px] text-[var(--theme-muted)] hover:text-[var(--theme-text)] disabled:opacity-50"
          >
            <HugeiconsIcon icon={RefreshIcon} size={9} />
            {projectsQuery.isFetching ? 'Lädt…' : 'Aktualisieren'}
          </button>
        </header>
        {recentProjects.length === 0 ? (
          <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 text-xs text-[var(--theme-muted)]">
            {projectsQuery.isLoading
              ? 'Lade Verlauf…'
              : 'Noch keine Vorhersagen — abgeschlossene Projekte erscheinen hier.'}
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentProjects.map((project) => (
              <li key={project.project_id}>
                <ProjectCard project={project} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </PredictShell>
  )
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const buildStatus = project.build_task?.status ?? 'unknown'
  const buildOk = buildStatus === 'completed'
  const buildRunning = buildStatus === 'queued' || buildStatus === 'running'
  const buildFailed = buildStatus === 'failed'
  return (
    <Link
      to="/predict/$projectId/build"
      params={{ projectId: project.project_id }}
      className="block rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 transition hover:border-[var(--theme-accent)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-mono uppercase text-[var(--theme-muted)]">
          {project.project_id.slice(0, 16)}
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
            buildOk && 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent)]',
            buildFailed && 'bg-red-500/20 text-red-300',
            buildRunning && 'bg-yellow-500/15 text-yellow-200',
            !buildOk && !buildFailed && !buildRunning && 'bg-[var(--theme-bg)] text-[var(--theme-muted)]',
          )}
        >
          {buildStatus}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm">{project.prompt || '(kein Prompt)'}</p>
      <div className="mt-2 flex items-center gap-3 text-[10px] text-[var(--theme-muted)]">
        <span>{project.document_count} {project.document_count === 1 ? 'Datei' : 'Dateien'}</span>
        <span>·</span>
        <span>{project.simulation_count} Sims</span>
        <span>·</span>
        <span>{project.report_count} Reports</span>
      </div>
      <div className="mt-1 text-[10px] text-[var(--theme-muted)]">
        {new Date(project.created_at).toLocaleString()}
      </div>
    </Link>
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
