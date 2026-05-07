import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  CrownIcon,
  File01Icon,
  JusticeScale02Icon,
  RefreshIcon,
  MagicWand01Icon,
  StopCircleIcon,
  Upload04Icon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { Markdown } from '@/components/prompt-kit/markdown'

type CouncilMode = 'chairman' | 'debate' | 'moa'

type ModelEntry = { id: string; name?: string; provider?: string }

type RoundEvent = { round: number; models: Array<string>; label?: string }
type AnswerEvent = { round: number; model: string; content: string }
type ErrorEvent = { model?: string; error?: string }
type FinalEvent = {
  content: string
  mode: CouncilMode
  totalTokens?: number
  promptTokens?: number
  completionTokens?: number
  chairman?: string
  rounds?: number
}

type LogEntry =
  | ({ type: 'round' } & RoundEvent)
  | ({ type: 'answer' } & AnswerEvent)
  | ({ type: 'error' } & ErrorEvent)

type CouncilAttachment = {
  id: string
  name: string
  contentType: string
  size: number
  dataUrl: string
}

const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024 // 5 MB pro Datei

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  })
}

const MODES: ReadonlyArray<{
  id: CouncilMode
  title: string
  subtitle: string
  bullets: Array<string>
  cost: string
  eta: string
  recommended?: boolean
}> = [
  {
    id: 'chairman',
    title: 'Chairman',
    subtitle: 'Schnell, einfach — gute Baseline.',
    bullets: [
      'Alle Mitglieder antworten parallel.',
      'Ein Vorsitzender (Chairman) liest alle Antworten und schreibt eine zusammengefasste Endantwort.',
      'Mitglieder reden NICHT miteinander — sehen nur die finale Synthese.',
    ],
    cost: 'Tokens: N + 1 Aufruf',
    eta: '~10–20s',
    recommended: true,
  },
  {
    id: 'debate',
    title: 'Debate',
    subtitle: 'Bessere Qualität bei kontroversen Fragen.',
    bullets: [
      'Runde 1: alle antworten parallel.',
      'Runde 2: jedes Mitglied sieht die Antworten der anderen und überarbeitet seine eigene.',
      'Chairman synthetisiert die finalen Versionen.',
    ],
    cost: 'Tokens: N × Runden + 1',
    eta: '~25–45s',
  },
  {
    id: 'moa',
    title: 'Mixture-of-Agents',
    subtitle: 'Höchste Qualität, mehr Tokens.',
    bullets: [
      'Layer 1: alle antworten parallel.',
      'Layer 2: jedes Modell synthetisiert die Layer-1-Antworten zu einer verbesserten Version.',
      'Chairman synthetisiert Layer 2 zur finalen Antwort.',
    ],
    cost: 'Tokens: 2N + 1',
    eta: '~35–60s',
  },
]

type Step = 1 | 2 | 3
type ViewMode = 'wizard' | 'history'

type CouncilTemplate = {
  id: string
  title: string
  description: string
  mode: CouncilMode
  models: Array<string>
  chairman: string
}

// Templates pre-select sensible model+mode combos for common scenarios.
// Falls back gracefully if a referenced model isn't in the available list
// (we filter on apply).
const COUNCIL_TEMPLATES: ReadonlyArray<CouncilTemplate> = [
  {
    id: 'code-review',
    title: 'Code-Review',
    description: 'Code+Review-Modelle, Debate-Modus für Streitfragen',
    mode: 'debate',
    models: ['qwen3-coder:480b', 'kimi-k2.6', 'glm-5.1'],
    chairman: 'qwen3-coder:480b',
  },
  {
    id: 'decision',
    title: 'Entscheidung',
    description: 'Reasoning-Modelle, Debate für Pro/Contra-Abwägung',
    mode: 'debate',
    models: ['kimi-k2.6', 'deepseek-v4-pro', 'glm-5.1'],
    chairman: 'kimi-k2.6',
  },
  {
    id: 'research',
    title: 'Recherche',
    description: 'Großer Pool, Mixture-of-Agents für maximale Qualität',
    mode: 'moa',
    models: ['kimi-k2.6', 'qwen3.5:397b', 'glm-5.1', 'deepseek-v4-pro'],
    chairman: 'kimi-k2.6',
  },
  {
    id: 'brainstorm',
    title: 'Brainstorm',
    description: 'Schnelle parallele Ideen, Chairman-Synthese',
    mode: 'chairman',
    models: ['kimi-k2.6', 'glm-5.1', 'deepseek-v4-pro'],
    chairman: 'glm-5.1',
  },
]

type HistoryEntry = {
  id: string
  startedAt: number
  finishedAt: number | null
  ok: boolean
  mode: string
  models: Array<string>
  chairman: string
  question: string
  totalTokens: number | null
}

/** localStorage key holding `{ startedAt, mode, question }` for the
 * currently-running council. Set on run start, cleared on completion or
 * error. Used to render a resume-from-history banner if the user
 * reloads/navigates back while a run is still in flight. */
const ACTIVE_RUN_STORAGE_KEY = 'council:active-run'

/** How long after a run start we still consider the active-run signal
 * useful. Beyond this we drop the marker — the run is almost certainly
 * either finished (and persisted to history) or genuinely lost. */
const ACTIVE_RUN_RESUME_WINDOW_MS = 10 * 60_000

type ActiveRunMarker = { startedAt: number; mode: string; question: string }

function readActiveRunMarker(): ActiveRunMarker | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_RUN_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ActiveRunMarker>
    if (
      typeof parsed.startedAt === 'number' &&
      typeof parsed.mode === 'string' &&
      typeof parsed.question === 'string' &&
      Date.now() - parsed.startedAt < ACTIVE_RUN_RESUME_WINDOW_MS
    ) {
      return parsed as ActiveRunMarker
    }
  } catch {
    /* corrupt — drop it */
  }
  try {
    window.localStorage.removeItem(ACTIVE_RUN_STORAGE_KEY)
  } catch {
    /* noop */
  }
  return null
}

export function CouncilScreen() {
  const [view, setView] = useState<ViewMode>('wizard')
  const [step, setStep] = useState<Step>(1)
  const [mode, setMode] = useState<CouncilMode>('chairman')
  const [selected, setSelected] = useState<Array<string>>([])
  const [chairman, setChairman] = useState<string>('')
  const [question, setQuestion] = useState('')
  const [attachments, setAttachments] = useState<Array<CouncilAttachment>>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<Array<LogEntry>>([])
  const [final, setFinal] = useState<FinalEvent | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Resume-from-history banner: if the user reloads while a run is still
  // in flight, the server-side persistence eventually lands the result
  // in council history — surface a hint so they don't think it's lost.
  const [resumeMarker, setResumeMarker] = useState<ActiveRunMarker | null>(
    () => (typeof window === 'undefined' ? null : readActiveRunMarker()),
  )

  const modelsQuery = useQuery({
    queryKey: ['models'],
    queryFn: async () => {
      const res = await fetch('/api/models')
      if (!res.ok) return { models: [] as Array<ModelEntry> }
      return (await res.json()) as { models: Array<ModelEntry> }
    },
    staleTime: 5 * 60 * 1000,
  })
  const availableModels = useMemo(
    () =>
      (modelsQuery.data?.models ?? []).filter(
        (m) => m.id && m.id !== 'hermes-agent',
      ),
    [modelsQuery.data],
  )

  useEffect(() => {
    if (availableModels.length === 0 || selected.length > 0) return
    const defaults = availableModels.slice(0, Math.min(3, availableModels.length)).map((m) => m.id)
    setSelected(defaults)
    setChairman(defaults[0])
  }, [availableModels, selected.length])

  function toggleModel(id: string) {
    setSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
      if (chairman && !next.includes(chairman)) {
        setChairman(next[0] ?? '')
      } else if (!chairman && next.length > 0) {
        setChairman(next[0])
      }
      return next
    })
  }

  function reset() {
    setStep(1)
    setQuestion('')
    setAttachments([])
    setAttachmentError(null)
    setLog([])
    setFinal(null)
  }

  function applyTemplate(template: CouncilTemplate) {
    setMode(template.mode)
    // Filter to models actually available
    const available = availableModels.map((m) => m.id)
    const wanted = template.models.filter((m) => available.includes(m))
    if (wanted.length >= 2) {
      setSelected(wanted)
      setChairman(
        available.includes(template.chairman) ? template.chairman : wanted[0],
      )
    } else if (wanted.length > 0) {
      // partial template — keep what we can
      setSelected(wanted)
      setChairman(wanted[0])
    }
  }

  const historyQuery = useQuery({
    queryKey: ['council-history'],
    queryFn: async () => {
      const res = await fetch('/api/council')
      if (!res.ok) return { sessions: [] as Array<HistoryEntry> }
      return (await res.json()) as { sessions: Array<HistoryEntry> }
    },
    enabled: view === 'history',
    staleTime: 30_000,
  })

  const [historySelectedId, setHistorySelectedId] = useState<string | null>(null)
  const historyDetailQuery = useQuery({
    queryKey: ['council-history-detail', historySelectedId],
    queryFn: async () => {
      if (!historySelectedId) return null
      const res = await fetch(
        `/api/council?id=${encodeURIComponent(historySelectedId)}`,
      )
      if (!res.ok) return null
      const data = (await res.json()) as { session?: unknown }
      return data.session ?? null
    },
    enabled: Boolean(historySelectedId),
    staleTime: 60_000,
  })

  async function addFiles(files: FileList | Array<File>) {
    setAttachmentError(null)
    const list = Array.from(files)
    const next: Array<CouncilAttachment> = []
    for (const file of list) {
      if (file.size > ATTACHMENT_MAX_BYTES) {
        setAttachmentError(
          `${file.name} ist größer als 5 MB — bitte trunkieren oder splitten.`,
        )
        continue
      }
      try {
        const dataUrl = await readAsDataUrl(file)
        next.push({
          id: crypto.randomUUID(),
          name: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl,
        })
      } catch (err) {
        setAttachmentError(
          `${file.name} konnte nicht gelesen werden: ${(err as Error).message}`,
        )
      }
    }
    if (next.length > 0) {
      setAttachments((prev) => [...prev, ...next])
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  async function runCouncil() {
    if (running) return
    if (selected.length < 2 || !question.trim()) return
    setLog([])
    setFinal(null)
    setRunning(true)
    setResumeMarker(null)
    const controller = new AbortController()
    abortRef.current = controller
    // Mark this run as active so a returning user (mid-stream reload) can
    // be invited to resume from history. Cleared when the stream emits a
    // final event or hits an error path below.
    const runStartedAt = Date.now()
    try {
      window.localStorage.setItem(
        ACTIVE_RUN_STORAGE_KEY,
        JSON.stringify({ startedAt: runStartedAt, mode, question: question.trim() }),
      )
    } catch {
      /* noop */
    }
    // Idle-timeout watchdog: if no SSE chunk arrives for IDLE_TIMEOUT_MS the
    // upstream is wedged (Cloudflare cull, Ollama hang). Abort the fetch and
    // surface an error event so the UI doesn't sit in "Council tagt…" forever.
    let lastChunkAt = Date.now()
    const IDLE_TIMEOUT_MS = 5 * 60_000
    const idleTimer = setInterval(() => {
      if (Date.now() - lastChunkAt > IDLE_TIMEOUT_MS) {
        controller.abort()
      }
    }, 15_000)
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    try {
      const res = await fetch('/api/council', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          models: selected,
          chairman: chairman || selected[0],
          question: question.trim(),
          attachments: attachments.map((a) => ({
            name: a.name,
            contentType: a.contentType,
            size: a.size,
            dataUrl: a.dataUrl,
          })),
        }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => '')
        setLog((prev) => [
          ...prev,
          { type: 'error', error: `HTTP ${res.status}: ${txt.slice(0, 200)}` },
        ])
        return
      }
      reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        lastChunkAt = Date.now()
        buf += decoder.decode(value, { stream: true })
        const events = buf.split('\n\n')
        buf = events.pop() ?? ''
        for (const ev of events) {
          if (!ev.trim()) continue
          const lines = ev.split('\n')
          let evtName = 'message'
          let dataStr = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) evtName = line.slice(7).trim()
            else if (line.startsWith('data: ')) dataStr += line.slice(6)
          }
          if (!dataStr) continue
          let data: unknown
          try {
            data = JSON.parse(dataStr)
          } catch {
            continue
          }
          if (evtName === 'round') {
            setLog((prev) => [...prev, { type: 'round', ...(data as RoundEvent) }])
          } else if (evtName === 'answer') {
            setLog((prev) => [...prev, { type: 'answer', ...(data as AnswerEvent) }])
          } else if (evtName === 'error') {
            setLog((prev) => [...prev, { type: 'error', ...(data as ErrorEvent) }])
          } else if (evtName === 'final') {
            setFinal(data as FinalEvent)
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // Distinguish manual abort from idle-timeout abort.
        const idle = Date.now() - lastChunkAt > IDLE_TIMEOUT_MS
        if (idle) {
          setLog((prev) => [
            ...prev,
            { type: 'error', error: `Council-Stream nach ${Math.round(IDLE_TIMEOUT_MS / 60_000)} min ohne Antwort abgebrochen.` },
          ])
        }
      } else {
        setLog((prev) => [...prev, { type: 'error', error: (err as Error).message }])
      }
    } finally {
      clearInterval(idleTimer)
      try {
        reader?.releaseLock()
      } catch {
        /* noop */
      }
      setRunning(false)
      abortRef.current = null
      try {
        window.localStorage.removeItem(ACTIVE_RUN_STORAGE_KEY)
      } catch {
        /* noop */
      }
    }
  }

  function abort() {
    abortRef.current?.abort()
  }

  const canAdvanceFromStep1 = Boolean(mode)
  const canAdvanceFromStep2 = selected.length >= 2 && Boolean(chairman)
  const canRun = canAdvanceFromStep2 && question.trim().length > 0 && !running

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 text-[var(--theme-text)]">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-2.5">
            <HugeiconsIcon icon={JusticeScale02Icon} size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Council</h1>
            <p className="text-sm text-[var(--theme-muted)]">
              Mehrere KIs beraten gemeinsam, eine vereinte Antwort.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[var(--theme-border)] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setView('wizard')}
              className={cn(
                'flex items-center gap-1 rounded-md px-3 py-1',
                view === 'wizard'
                  ? 'bg-[var(--theme-accent)] text-primary-950'
                  : 'text-[var(--theme-muted)] hover:bg-[var(--theme-bg)]',
              )}
            >
              <HugeiconsIcon icon={MagicWand01Icon} size={12} />
              Neuer Council
            </button>
            <button
              type="button"
              onClick={() => setView('history')}
              className={cn(
                'flex items-center gap-1 rounded-md px-3 py-1',
                view === 'history'
                  ? 'bg-[var(--theme-accent)] text-primary-950'
                  : 'text-[var(--theme-muted)] hover:bg-[var(--theme-bg)]',
              )}
            >
              <HugeiconsIcon icon={Clock01Icon} size={12} />
              Verlauf
            </button>
          </div>
          {view === 'wizard' && (log.length > 0 || final || step !== 1) ? (
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1 rounded-lg border border-[var(--theme-border)] px-3 py-1.5 text-xs text-[var(--theme-muted)] hover:bg-[var(--theme-bg)]"
            >
              <HugeiconsIcon icon={RefreshIcon} size={14} />
              Neu starten
            </button>
          ) : null}
        </div>
      </header>

      {resumeMarker && !running ? (
        <div className="rounded-xl border border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] p-3 text-sm">
          <div className="flex items-start gap-3">
            <HugeiconsIcon icon={Clock01Icon} size={18} />
            <div className="flex-1">
              <div className="font-semibold">Council läuft im Hintergrund</div>
              <div className="text-xs text-[var(--theme-muted)] mt-1">
                Vor {Math.round((Date.now() - resumeMarker.startedAt) / 60_000)} min
                gestartet · Modus {resumeMarker.mode}. Falls die Verbindung abbrach,
                lädt die Antwort gleich im Verlauf.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setView('history')}
                className="rounded-lg bg-[var(--theme-accent)] px-3 py-1.5 text-xs font-semibold text-primary-950"
              >
                Verlauf öffnen
              </button>
              <button
                type="button"
                onClick={() => {
                  setResumeMarker(null)
                  try {
                    window.localStorage.removeItem(ACTIVE_RUN_STORAGE_KEY)
                  } catch {
                    /* noop */
                  }
                }}
                className="rounded-lg border border-[var(--theme-border)] px-3 py-1.5 text-xs text-[var(--theme-muted)]"
              >
                Verwerfen
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {view === 'history' ? (
        <CouncilHistory
          history={historyQuery.data?.sessions ?? []}
          loading={historyQuery.isLoading}
          selectedId={historySelectedId}
          onSelect={setHistorySelectedId}
          detail={historyDetailQuery.data}
          detailLoading={historyDetailQuery.isLoading}
        />
      ) : (
        <>
      <Stepper step={step} />

      {step === 1 && (
        <>
          <CouncilTemplates onApply={applyTemplate} />
          <Step1Mode mode={mode} setMode={setMode} />
        </>
      )}

      {step === 2 && (
        <Step2Models
          modelsLoading={modelsQuery.isLoading}
          available={availableModels}
          selected={selected}
          chairman={chairman}
          onToggle={toggleModel}
          onChairman={setChairman}
        />
      )}

      {step === 3 && (
        <Step3Question
          mode={mode}
          selected={selected}
          chairman={chairman}
          question={question}
          setQuestion={setQuestion}
          attachments={attachments}
          attachmentError={attachmentError}
          addFiles={addFiles}
          removeAttachment={removeAttachment}
          running={running}
          canRun={canRun}
          run={runCouncil}
          abort={abort}
        />
      )}

      <nav className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => (Math.max(1, s - 1) as Step))}
          disabled={step === 1 || running}
          className="flex items-center gap-1 rounded-xl border border-[var(--theme-border)] px-4 py-2 text-xs font-medium hover:bg-[var(--theme-bg)] disabled:opacity-40"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
          Zurück
        </button>
        {step < 3 && (
          <button
            type="button"
            onClick={() => setStep((s) => (Math.min(3, s + 1) as Step))}
            disabled={
              (step === 1 && !canAdvanceFromStep1) ||
              (step === 2 && !canAdvanceFromStep2)
            }
            className="flex items-center gap-1 rounded-xl bg-[var(--theme-accent)] px-4 py-2 text-xs font-semibold text-primary-950 hover:bg-[var(--theme-accent-strong)] disabled:opacity-40"
          >
            Weiter
            <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
          </button>
        )}
      </nav>

      {(log.length > 0 || final) && <CouncilOutput log={log} final={final} />}
        </>
      )}
    </div>
  )
}

function CouncilTemplates({
  onApply,
}: {
  onApply: (template: CouncilTemplate) => void
}) {
  return (
    <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3">
      <div className="mb-2 flex items-center gap-2">
        <HugeiconsIcon icon={MagicWand01Icon} size={14} />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--theme-muted)]">
          Schnell-Setup
        </h2>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        {COUNCIL_TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            onClick={() => onApply(tpl)}
            className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-left text-xs hover:border-[var(--theme-accent)]"
          >
            <div className="font-semibold">{tpl.title}</div>
            <div className="mt-0.5 text-[10px] text-[var(--theme-muted)]">
              {tpl.description}
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

function CouncilHistory({
  history,
  loading,
  selectedId,
  onSelect,
  detail,
  detailLoading,
}: {
  history: Array<HistoryEntry>
  loading: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  detail: unknown
  detailLoading: boolean
}) {
  if (loading) {
    return <p className="text-sm text-[var(--theme-muted)]">Lade Verlauf…</p>
  }
  if (history.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--theme-border)] p-6 text-center text-sm text-[var(--theme-muted)]">
        Noch keine Council-Sessions. Starte einen über „Neuer Council".
      </div>
    )
  }
  const detailRecord = detail as
    | {
        question?: string
        finalContent?: string | null
        mode?: string
        models?: Array<string>
        chairman?: string
        startedAt?: number
        totalTokens?: number | null
        log?: Array<{ event: string; data: unknown }>
      }
    | null
    | undefined
  return (
    <div className="grid gap-4 md:grid-cols-[18rem,1fr]">
      <ul className="space-y-2 max-h-[70vh] overflow-y-auto">
        {history.map((h) => {
          const date = new Date(h.startedAt)
          const isActive = h.id === selectedId
          return (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => onSelect(h.id)}
                className={cn(
                  'w-full rounded-xl border p-3 text-left text-xs transition-all',
                  isActive
                    ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)]'
                    : 'border-[var(--theme-border)] bg-[var(--theme-card)] hover:bg-[var(--theme-bg)]',
                )}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold">{h.mode}</span>
                  <span className="text-[10px] text-[var(--theme-muted)]">
                    {date.toLocaleString()}
                  </span>
                </div>
                <p className="line-clamp-2 text-[var(--theme-text)]">
                  {h.question}
                </p>
                <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[var(--theme-muted)]">
                  <span>{h.models.length} Mitglieder</span>
                  {h.totalTokens ? <span>· {h.totalTokens} tokens</span> : null}
                  {!h.ok ? (
                    <span className="text-red-400">· fehlgeschlagen</span>
                  ) : null}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
      <div>
        {!selectedId ? (
          <p className="text-sm text-[var(--theme-muted)]">
            Wähle eine Session links zur Detailansicht.
          </p>
        ) : detailLoading ? (
          <p className="text-sm text-[var(--theme-muted)]">Lade Details…</p>
        ) : !detailRecord ? (
          <p className="text-sm text-red-400">Session nicht gefunden.</p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 text-xs">
              <div className="mb-1 font-semibold">Frage</div>
              <p className="whitespace-pre-wrap text-[var(--theme-text)]">
                {detailRecord.question}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--theme-muted)]">
                <span>Mode: {detailRecord.mode}</span>
                <span>· Chairman: {detailRecord.chairman}</span>
                <span>
                  · Mitglieder: {(detailRecord.models ?? []).join(', ')}
                </span>
                {detailRecord.totalTokens ? (
                  <span>· {detailRecord.totalTokens} tokens</span>
                ) : null}
              </div>
            </div>
            {detailRecord.finalContent ? (
              <div className="rounded-2xl border-2 border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-bold">
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} />
                  Finale Antwort
                </div>
                <div className="prose prose-sm max-w-none text-[var(--theme-text)]">
                  <Markdown>{detailRecord.finalContent}</Markdown>
                </div>
              </div>
            ) : null}
            {detailRecord.log && detailRecord.log.length > 0 ? (
              <details className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3">
                <summary className="cursor-pointer text-xs font-semibold">
                  Verlauf ({detailRecord.log.length} Events)
                </summary>
                <div className="mt-2 space-y-2">
                  {detailRecord.log.map((entry, i) => (
                    <pre
                      key={i}
                      className="max-h-72 overflow-auto rounded-lg bg-[var(--theme-bg)] p-2 text-[10px]"
                    >
                      {JSON.stringify(entry, null, 2)}
                    </pre>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

function Stepper({ step }: { step: Step }) {
  const steps = [
    { n: 1, label: 'Modus' },
    { n: 2, label: 'Mitglieder' },
    { n: 3, label: 'Frage' },
  ]
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-2">
      {steps.map((s, i) => (
        <div key={s.n} className="flex flex-1 items-center gap-2">
          <div
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
              s.n === step
                ? 'bg-[var(--theme-accent)] text-primary-950'
                : s.n < step
                  ? 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent)]'
                  : 'bg-[var(--theme-bg)] text-[var(--theme-muted)]',
            )}
          >
            {s.n < step ? (
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} />
            ) : (
              s.n
            )}
          </div>
          <span
            className={cn(
              'text-xs',
              s.n === step
                ? 'font-semibold text-[var(--theme-text)]'
                : 'text-[var(--theme-muted)]',
            )}
          >
            {s.label}
          </span>
          {i < steps.length - 1 && (
            <div className="ml-2 h-px flex-1 bg-[var(--theme-border)]" />
          )}
        </div>
      ))}
    </div>
  )
}

function Step1Mode({
  mode,
  setMode,
}: {
  mode: CouncilMode
  setMode: (m: CouncilMode) => void
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Welcher Modus?</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {MODES.map((m) => {
          const active = mode === m.id
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cn(
                'rounded-2xl border p-4 text-left transition-all',
                active
                  ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)]'
                  : 'border-[var(--theme-border)] bg-[var(--theme-card)] hover:bg-[var(--theme-bg)]',
              )}
            >
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{m.title}</h3>
                <div className="flex gap-1">
                  {m.recommended && (
                    <span className="rounded-full bg-[var(--theme-accent-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--theme-accent)]">
                      Empfohlen
                    </span>
                  )}
                  {active && (
                    <span className="rounded-full bg-[var(--theme-accent)] px-2 py-0.5 text-[10px] font-bold text-primary-950">
                      ✓
                    </span>
                  )}
                </div>
              </div>
              <p className="mb-2 text-xs text-[var(--theme-muted)]">{m.subtitle}</p>
              <ul className="mb-3 space-y-1 text-[11px]">
                {m.bullets.map((b, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-[var(--theme-accent)]">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-3 text-[10px] text-[var(--theme-muted)]">
                <span>{m.cost}</span>
                <span>{m.eta}</span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function Step2Models({
  modelsLoading,
  available,
  selected,
  chairman,
  onToggle,
  onChairman,
}: {
  modelsLoading: boolean
  available: Array<ModelEntry>
  selected: Array<string>
  chairman: string
  onToggle: (id: string) => void
  onChairman: (id: string) => void
}) {
  return (
    <section className="space-y-4">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <HugeiconsIcon icon={UserMultipleIcon} size={16} />
          <h2 className="text-sm font-semibold">Mitglieder</h2>
          <span className="text-xs text-[var(--theme-muted)]">
            ({selected.length} ausgewählt · min. 2)
          </span>
        </div>
        {modelsLoading ? (
          <p className="text-xs text-[var(--theme-muted)]">Modelle werden geladen…</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {available.map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => onToggle(m.id)}
                className={cn(
                  'flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs transition-all',
                  selected.includes(m.id)
                    ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)]'
                    : 'border-[var(--theme-border)] bg-[var(--theme-card)] hover:bg-[var(--theme-bg)]',
                )}
              >
                <div>
                  <div className="font-medium">{m.id}</div>
                  {m.provider && (
                    <div className="text-[10px] text-[var(--theme-muted)]">{m.provider}</div>
                  )}
                </div>
                <div
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-md border',
                    selected.includes(m.id)
                      ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)] text-primary-950'
                      : 'border-[var(--theme-border)]',
                  )}
                >
                  {selected.includes(m.id) ? '✓' : ''}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected.length >= 1 && (
        <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
          <div className="mb-2 flex items-center gap-2">
            <HugeiconsIcon icon={CrownIcon} size={16} />
            <h3 className="text-sm font-semibold">Vorsitzender</h3>
          </div>
          <p className="mb-2 text-[11px] text-[var(--theme-muted)]">
            Der Vorsitzende synthetisiert die finalen Antworten zur einer einheitlichen Endantwort.
          </p>
          <div className="grid gap-2 md:grid-cols-3">
            {selected.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChairman(m)}
                className={cn(
                  'rounded-xl border px-3 py-2 text-xs',
                  chairman === m
                    ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] font-semibold'
                    : 'border-[var(--theme-border)] hover:bg-[var(--theme-bg)]',
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function Step3Question({
  mode,
  selected,
  chairman,
  question,
  setQuestion,
  attachments,
  attachmentError,
  addFiles,
  removeAttachment,
  running,
  canRun,
  run,
  abort,
}: {
  mode: CouncilMode
  selected: Array<string>
  chairman: string
  question: string
  setQuestion: (q: string) => void
  attachments: Array<CouncilAttachment>
  attachmentError: string | null
  addFiles: (files: FileList | Array<File>) => void | Promise<void>
  removeAttachment: (id: string) => void
  running: boolean
  canRun: boolean
  run: () => void
  abort: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [dragOver, setDragOver] = useState(false)
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
        <div className="mb-2 text-[11px] uppercase tracking-wider text-[var(--theme-muted)]">
          Setup
        </div>
        <div className="grid gap-2 text-xs md:grid-cols-3">
          <div>
            <span className="text-[var(--theme-muted)]">Modus: </span>
            <span className="font-semibold">
              {MODES.find((m) => m.id === mode)?.title}
            </span>
          </div>
          <div>
            <span className="text-[var(--theme-muted)]">Mitglieder: </span>
            <span className="font-semibold">{selected.length}</span>
          </div>
          <div>
            <span className="text-[var(--theme-muted)]">Vorsitzender: </span>
            <span className="font-semibold">{chairman}</span>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((m) => (
            <span
              key={m}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px]',
                m === chairman
                  ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] font-semibold'
                  : 'border-[var(--theme-border)]',
              )}
            >
              {m === chairman ? '👑 ' : ''}
              {m}
            </span>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-2 block text-sm font-semibold">Frage / Auftrag</label>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Was sollen die Mitglieder beantworten?"
          className="h-40 w-full rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 text-sm outline-none focus:border-[var(--theme-accent)]"
          disabled={running}
        />
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-semibold">Dokumente (optional)</label>
          <span className="text-[10px] text-[var(--theme-muted)]">
            Text/Markdown/Code/Bilder · max 5 MB pro Datei
          </span>
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            if (e.dataTransfer.files.length > 0) {
              void addFiles(e.dataTransfer.files)
            }
          }}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-all',
            dragOver
              ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)]'
              : 'border-[var(--theme-border)] bg-[var(--theme-card)] hover:border-[var(--theme-accent)]',
          )}
        >
          <HugeiconsIcon icon={Upload04Icon} size={24} className="text-[var(--theme-muted)]" />
          <p className="text-xs text-[var(--theme-muted)]">
            Dateien hier ablegen oder klicken zum Auswählen
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,.markdown,.json,.yaml,.yml,.csv,.tsv,.toml,.ini,.cfg,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.cpp,.h,.hpp,.cs,.sh,.html,.css,.xml,.sql,.graphql,.svg,image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) {
                void addFiles(e.target.files)
                e.target.value = ''
              }
            }}
          />
        </div>
        {attachmentError && (
          <p className="mt-2 text-xs text-red-400">⚠ {attachmentError}</p>
        )}
        {attachments.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {attachments.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-xs"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <HugeiconsIcon icon={File01Icon} size={14} />
                  <span className="truncate font-medium">{a.name}</span>
                  <span className="shrink-0 text-[10px] text-[var(--theme-muted)]">
                    {(a.size / 1024).toFixed(1)} KB
                    {a.contentType ? ` · ${a.contentType}` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  className="ml-2 rounded-lg px-2 py-0.5 text-[var(--theme-muted)] hover:bg-[var(--theme-bg)] hover:text-[var(--theme-text)]"
                  title="Entfernen"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        {running && (
          <button
            type="button"
            onClick={abort}
            className="flex items-center gap-1 rounded-xl border border-red-500 px-4 py-2 text-xs font-semibold text-red-500 hover:bg-red-500/10"
          >
            <HugeiconsIcon icon={StopCircleIcon} size={14} />
            Abbrechen
          </button>
        )}
        <button
          type="button"
          onClick={run}
          disabled={!canRun}
          className="flex items-center gap-2 rounded-xl bg-[var(--theme-accent)] px-5 py-2 text-xs font-semibold text-primary-950 hover:bg-[var(--theme-accent-strong)] disabled:opacity-40"
        >
          <HugeiconsIcon icon={JusticeScale02Icon} size={14} />
          {running ? 'Council tagt…' : 'Council einberufen'}
        </button>
      </div>
    </section>
  )
}

function CouncilOutput({
  log,
  final,
}: {
  log: Array<LogEntry>
  final: FinalEvent | null
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Verlauf</h2>
      {log.map((entry, idx) => {
        if (entry.type === 'round') {
          return (
            <div
              key={idx}
              className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-xs"
            >
              <span className="font-bold text-[var(--theme-accent)]">Runde {entry.round}</span>
              {entry.label ? (
                <span className="ml-2 text-[var(--theme-muted)]">— {entry.label}</span>
              ) : null}
              <span className="ml-2 text-[var(--theme-muted)]">({entry.models.join(', ')})</span>
            </div>
          )
        }
        if (entry.type === 'answer') {
          return (
            <details
              key={idx}
              className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3"
              open={false}
            >
              <summary className="cursor-pointer text-xs font-semibold">
                <span className="text-[var(--theme-muted)]">R{entry.round}</span> {entry.model}
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs text-[var(--theme-text)]">
                {entry.content}
              </pre>
            </details>
          )
        }
        if (entry.type === 'error') {
          return (
            <div
              key={idx}
              className="rounded-xl border border-red-500 bg-red-500/10 px-3 py-2 text-xs text-red-400"
            >
              ⚠ {entry.model ? `${entry.model}: ` : ''}
              {entry.error}
            </div>
          )
        }
        return null
      })}
      {final && (
        <div className="rounded-2xl border-2 border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} />
              Finale Antwort
            </h3>
            <span className="text-[10px] text-[var(--theme-muted)]">
              {MODES.find((m) => m.id === final.mode)?.title}
              {final.chairman ? ` · 👑 ${final.chairman}` : ''}
              {final.totalTokens ? ` · ${final.totalTokens} tokens` : ''}
            </span>
          </div>
          <div className="prose prose-sm max-w-none text-[var(--theme-text)]">
            <Markdown>{final.content}</Markdown>
          </div>
          <CouncilFinalActions content={final.content} />
        </div>
      )}
    </section>
  )
}

function CouncilFinalActions({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)
  const [savedToChat, setSavedToChat] = useState(false)
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard
            .writeText(content)
            .then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            })
            .catch(() => {})
        }}
        className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-1.5 text-xs hover:bg-[var(--theme-bg)]"
      >
        {copied ? '✓ Kopiert' : 'Kopieren'}
      </button>
      <button
        type="button"
        onClick={() => {
          try {
            window.localStorage.setItem(
              'council-prefill-chat',
              JSON.stringify({ content, at: Date.now() }),
            )
            setSavedToChat(true)
            setTimeout(() => {
              window.location.assign('/chat/main')
            }, 350)
          } catch {
            /* noop */
          }
        }}
        className="rounded-lg border border-[var(--theme-accent)] bg-[var(--theme-accent)] px-3 py-1.5 text-xs font-semibold text-primary-950 hover:bg-[var(--theme-accent-strong)]"
      >
        {savedToChat ? '→ Chat öffnet…' : 'In Chat einfügen'}
      </button>
    </div>
  )
}
