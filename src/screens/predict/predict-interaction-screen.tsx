import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Telescope01Icon,
  UserGroupIcon,
  CheckmarkCircle02Icon,
  AlertCircleIcon,
  Clock01Icon,
} from '@hugeicons/core-free-icons'
import { PhasePlaceholder, PredictShell } from './predict-shell'
import { ChatConversation } from './components/chat-conversation'
import { useBatchProgress } from './hooks/use-batch-progress'
import { useChatThread, type ChatThreadHandle } from './hooks/use-chat-thread'
import {
  predictClient,
  type PersonaSummary,
} from '@/server/predict-client'
import { Markdown } from '@/components/prompt-kit/markdown'
import { cn } from '@/lib/utils'

type Tab = 'agent' | 'persona' | 'survey'

// F-M3: server caps batch surveys at 50 personas — keep the UI in sync so
// users do not get a surprise rejection from the API.
const MAX_BATCH_PERSONAS = 50

export function PredictInteractionScreen({ reportId }: { reportId: string }) {
  if (!reportId || reportId === 'tbd') {
    return (
      <PredictShell
        step={5}
        title="Predict · Interaction"
        subtitle="Es gibt noch keinen Report — erst die Phasen 1–4 abschließen."
      >
        <PhasePlaceholder
          phase="Kein Report ausgewählt"
          description="Generiere zuerst einen Report (Phase 4) — dort findest du den Button 'Weiter zu Phase 5'."
        />
      </PredictShell>
    )
  }
  return <PredictInteractionContent reportId={reportId} />
}

function PredictInteractionContent({ reportId }: { reportId: string }) {
  const [tab, setTab] = useState<Tab>('agent')

  const reportQuery = useQuery({
    queryKey: ['predict', 'report', reportId],
    queryFn: () => predictClient.getReport(reportId),
  })

  const personasQuery = useQuery({
    queryKey: ['predict', 'personas-for-report', reportId, reportQuery.data?.simulation_id],
    queryFn: () =>
      reportQuery.data?.simulation_id
        ? predictClient.listPersonas(reportQuery.data.simulation_id)
        : Promise.resolve([] as Array<PersonaSummary>),
    enabled: !!reportQuery.data?.simulation_id,
  })

  const personas = personasQuery.data ?? []

  // F-H1/F-H2/F-M1: chat-thread hooks live at the parent so state survives
  // tab-switches and the persona-keyed map persists across persona switches.
  const [personaId, setPersonaId] = useState<string | null>(null)

  useEffect(() => {
    if (!personaId && personas.length > 0) {
      setPersonaId(personas[0]?.id ?? null)
    }
  }, [personas, personaId])

  const agentThread = useChatThread(reportId, 'agent')
  const personaThread = useChatThread(reportId, 'persona', personaId)

  return (
    <PredictShell
      step={5}
      title="Predict · Interaction"
      subtitle={`${reportId}${
        reportQuery.data?.simulation_id ? ` · sim ${reportQuery.data.simulation_id}` : ''
      } — Stress-Test der Vorhersage durch Q&A`}
    >
      <nav
        className="flex gap-1 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-1 text-xs"
        role="tablist"
      >
        {[
          { id: 'agent' as const, label: 'ReportAgent-Chat' },
          { id: 'persona' as const, label: '1:1 Persona-Chat' },
          { id: 'survey' as const, label: 'Batch-Survey' },
        ].map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={tab === opt.id}
            onClick={() => setTab(opt.id)}
            className={cn(
              'flex-1 rounded-lg px-3 py-2 font-semibold transition',
              tab === opt.id
                ? 'bg-[var(--theme-accent)] text-primary-950'
                : 'text-[var(--theme-muted)] hover:bg-[var(--theme-bg)]',
            )}
          >
            {opt.label}
          </button>
        ))}
      </nav>

      {tab === 'agent' ? <AgentChatTab thread={agentThread} /> : null}
      {tab === 'persona' ? (
        <PersonaChatTab
          personas={personas}
          personaId={personaId}
          onPersonaChange={setPersonaId}
          thread={personaThread}
        />
      ) : null}
      {tab === 'survey' ? <BatchSurveyTab reportId={reportId} personas={personas} /> : null}
    </PredictShell>
  )
}

// --- Tab 1: ReportAgent chat ---------------------------------------------

function AgentChatTab({ thread }: { thread: ChatThreadHandle }) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 text-xs text-[var(--theme-muted)]">
        Der ReportAgent kennt den vollständigen Report sowie die Sim-Top-Posts.
        Frag nach Begründungen, alternativen Szenarien, oder lass dir Stellen aus
        dem Report neu interpretieren.
      </div>
      {thread.error ? (
        <div className="rounded-xl border border-red-500 bg-red-500/10 p-3 text-xs text-red-200">{thread.error}</div>
      ) : null}
      <div className="h-[520px]">
        <ChatConversation
          title="ReportAgent"
          subtitle="Senior-Analyst der diese Vorhersage geschrieben hat"
          messages={thread.messages}
          busy={thread.busy}
          onSend={thread.send}
          inputPlaceholder="z.B. 'Welche Annahme im Stakeholder-Lager ist am brüchigsten?'"
        />
      </div>
    </div>
  )
}

// --- Tab 2: 1:1 persona chat ---------------------------------------------

function PersonaChatTab({
  personas,
  personaId,
  onPersonaChange,
  thread,
}: {
  personas: Array<PersonaSummary>
  personaId: string | null
  onPersonaChange: (id: string | null) => void
  thread: ChatThreadHandle
}) {
  const persona = useMemo(
    () => personas.find((p) => p.id === personaId) ?? null,
    [personas, personaId],
  )

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3">
        <label className="block text-xs">
          <span className="font-semibold text-[var(--theme-muted)]">Persona auswählen</span>
          <select
            value={personaId ?? ''}
            onChange={(e) => onPersonaChange(e.target.value || null)}
            disabled={personas.length === 0}
            className="mt-1 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2 py-1.5 text-sm focus:border-[var(--theme-accent)] focus:outline-none disabled:opacity-60"
          >
            {personas.length === 0 ? (
              <option value="">— keine Personas verfügbar —</option>
            ) : (
              personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.role || 'Persona'}
                </option>
              ))
            )}
          </select>
        </label>
        {persona ? (
          <div className="mt-3 text-[11px] text-[var(--theme-muted)]">
            <strong>Background:</strong> {persona.background.slice(0, 220) || '—'}
          </div>
        ) : null}
      </div>
      {thread.error ? (
        <div className="rounded-xl border border-red-500 bg-red-500/10 p-3 text-xs text-red-200">{thread.error}</div>
      ) : null}
      <div className="h-[520px]">
        <ChatConversation
          title={persona ? persona.name : 'Persona auswählen'}
          subtitle={persona ? persona.role : undefined}
          messages={thread.messages}
          busy={thread.busy}
          disabled={!persona}
          onSend={thread.send}
          inputPlaceholder={
            persona ? `Frage an ${persona.name}…` : 'Erst eine Persona auswählen'
          }
        />
      </div>
    </div>
  )
}

// --- Tab 3: batch survey -------------------------------------------------

function BatchSurveyTab({
  reportId,
  personas,
}: {
  reportId: string
  personas: Array<PersonaSummary>
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [question, setQuestion] = useState('')
  const [batchId, setBatchId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const batchHook = useBatchProgress(reportId, batchId)

  const batchQuery = useQuery({
    queryKey: ['predict', 'batch', batchId, batchHook.state.status],
    queryFn: () => (batchId ? predictClient.getInterviewBatch(reportId, batchId) : Promise.resolve(null)),
    enabled: !!batchId,
    refetchInterval:
      !batchId || batchHook.state.status === 'completed' || batchHook.state.status === 'failed'
        ? false
        : 5_000,
    placeholderData: (prev) => prev,
  })

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () =>
    setSelectedIds(
      new Set(personas.slice(0, MAX_BATCH_PERSONAS).map((p) => p.id)),
    )
  const clearAll = () => setSelectedIds(new Set())

  const handleSubmit = async () => {
    if (selectedIds.size === 0 || !question.trim() || creating) return
    setCreating(true)
    setError(null)
    try {
      const created = await predictClient.createInterviewBatch(reportId, {
        personaIds: [...selectedIds],
        question: question.trim(),
      })
      setBatchId(created.batch_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  // Merge live SSE state with persisted batch detail.
  const persistedRows = batchQuery.data?.responses ?? []
  const mergedRows = persistedRows.map((row) => {
    const live = batchHook.state.responsesById[row.persona_id]
    if (!live) return row
    return {
      ...row,
      status: live.status === 'pending' ? row.status : live.status,
      content: live.content || row.content,
      error: live.error || row.error,
    }
  })

  const total = batchQuery.data?.target_count ?? batchHook.state.targetCount ?? selectedIds.size
  const done = mergedRows.filter((r) => r.status === 'completed').length
  const failed = mergedRows.filter((r) => r.status === 'failed').length

  return (
    <div className="space-y-3">
      {!batchId ? (
        <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 space-y-3">
          <h3 className="text-sm font-semibold">Frage an mehrere Personas</h3>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-[var(--theme-muted)]">
              {selectedIds.size} / {Math.min(personas.length, MAX_BATCH_PERSONAS)} ausgewählt
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAll}
                className="rounded-full border border-[var(--theme-border)] px-2 py-1 text-[10px] hover:bg-[var(--theme-bg)]"
              >
                Alle
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="rounded-full border border-[var(--theme-border)] px-2 py-1 text-[10px] hover:bg-[var(--theme-bg)]"
              >
                Keine
              </button>
            </div>
          </div>
          {personas.length > MAX_BATCH_PERSONAS ? (
            <div className="rounded-xl border border-yellow-500 bg-yellow-500/10 p-2 text-[11px] text-yellow-200">
              Maximal {MAX_BATCH_PERSONAS} Personas pro Survey.
            </div>
          ) : null}
          <ul className="grid max-h-40 gap-1 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
            {personas.map((persona) => {
              const active = selectedIds.has(persona.id)
              return (
                <li key={persona.id}>
                  <button
                    type="button"
                    onClick={() => toggle(persona.id)}
                    aria-pressed={active}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition',
                      active
                        ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)]'
                        : 'border-[var(--theme-border)] hover:border-[var(--theme-accent)]',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                        active
                          ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)] text-primary-950'
                          : 'border-[var(--theme-border)]',
                      )}
                    >
                      {active ? '✓' : ''}
                    </span>
                    <span className="min-w-0 truncate" title={`${persona.name} — ${persona.role}`}>
                      {persona.name}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="z.B. 'Welcher Kompromiss würde dich umstimmen?'"
            rows={3}
            className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-3 text-sm focus:border-[var(--theme-accent)] focus:outline-none"
          />
          {error ? (
            <div className="rounded-xl border border-red-500 bg-red-500/10 p-2 text-xs text-red-200">
              {error}
            </div>
          ) : null}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={
                selectedIds.size === 0 ||
                selectedIds.size > MAX_BATCH_PERSONAS ||
                question.trim().length === 0 ||
                creating
              }
              onClick={handleSubmit}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--theme-accent)] px-4 py-2 text-sm font-semibold text-primary-950 hover:bg-[var(--theme-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <HugeiconsIcon icon={UserGroupIcon} size={14} />
              {creating ? 'Starte…' : `${selectedIds.size} Personas befragen`}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
            <div>
              <div className="text-xs text-[var(--theme-muted)]">Batch-Survey</div>
              <div className="font-mono text-sm">{batchId}</div>
              <div className="mt-1 text-xs">{batchQuery.data?.question ?? question}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase text-[var(--theme-muted)]">
                {batchHook.state.status}
              </div>
              <div className="text-sm font-semibold">
                {done} / {total} fertig{failed > 0 ? ` · ${failed} fail` : ''}
              </div>
              <button
                type="button"
                onClick={() => {
                  setBatchId(null)
                  setQuestion('')
                  setSelectedIds(new Set())
                }}
                className="mt-2 rounded-full border border-[var(--theme-border)] px-2 py-0.5 text-[10px] text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
              >
                Neue Survey
              </button>
            </div>
          </div>
          {mergedRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--theme-border)] bg-[var(--theme-card)] p-6 text-center text-xs text-[var(--theme-muted)]">
              Antworten erscheinen sobald die ersten Personas geantwortet haben — typischerweise
              in 30-90 Sekunden.
            </div>
          ) : (
            <ul className="space-y-3">
              {mergedRows.map((row) => (
                <li
                  key={row.persona_id}
                  className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4"
                >
                  <header className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">{row.persona_name}</div>
                      <div className="text-[10px] text-[var(--theme-muted)]">
                        {row.persona_role}
                      </div>
                    </div>
                    <StatusPill status={row.status} />
                  </header>
                  {row.content ? (
                    <div className="prose prose-sm mt-3 max-w-none text-[var(--theme-text)]">
                      <Markdown>{row.content}</Markdown>
                    </div>
                  ) : row.status === 'failed' ? (
                    <p className="mt-2 text-xs text-red-300">{row.error || 'Antwort gescheitert.'}</p>
                  ) : (
                    <p className="mt-2 text-xs text-[var(--theme-muted)]">Wartet auf LLM…</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'completed'
      ? 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent)]'
      : status === 'failed'
        ? 'bg-red-500/20 text-red-300'
        : status === 'running'
          ? 'bg-yellow-500/15 text-yellow-200'
          : 'bg-[var(--theme-bg)] text-[var(--theme-muted)]'
  const Icon =
    status === 'completed'
      ? CheckmarkCircle02Icon
      : status === 'failed'
        ? AlertCircleIcon
        : status === 'running'
          ? Clock01Icon
          : Telescope01Icon
  return (
    <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', tone)}>
      <HugeiconsIcon icon={Icon} size={10} />
      {status}
    </span>
  )
}
