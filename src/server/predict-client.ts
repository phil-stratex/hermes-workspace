/**
 * Browser-side client for the Stratex Predict API.
 *
 * All requests go through `/api/predict-proxy/<path>` so the bearer
 * token stays server-side. SSE streams use `EventSource` against the
 * same proxy — the splat handler streams responses unchanged.
 */

const PROXY_BASE = '/api/predict-proxy'

export type PredictDependencyStatus = {
  name: string
  ok: boolean
  detail?: string | null
}

export type PredictHealth = {
  status: 'ok' | 'degraded'
  version: string
  dependencies: Array<PredictDependencyStatus>
}

export type CreatedProject = {
  project_id: string
  build_task_id: string
  status: string
  documents: Array<string>
}

export type BuildTaskState = {
  id: string
  phase: number
  progress: number
  status: 'queued' | 'running' | 'completed' | 'failed' | string
  error: string | null
}

export type ProjectDocumentSummary = {
  id: string
  name: string
  mime: string
  size_bytes: number
  truncated: boolean
  char_count: number
}

export type ProjectSummary = {
  project_id: string
  prompt: string
  status: string
  created_at: string
  document_count: number
  build_task: BuildTaskState | null
  simulation_count: number
  report_count: number
}

export type SimulationSummaryRow = {
  simulation_id: string
  project_id: string
  status: string
  config: SimulationConfig
  created_at: string
  persona_count: number
  has_active_run: boolean
  has_completed_run: boolean
}

export type ReportSummaryRow = {
  report_id: string
  simulation_id: string
  status: string
  progress: number
  created_at: string
  finished_at: string | null
  section_total: number
  section_completed: number
}

export type ProjectDetail = {
  project_id: string
  prompt: string
  status: string
  created_at: string
  documents: Array<ProjectDocumentSummary>
  build_task: BuildTaskState | null
}

export type GraphNode = {
  id: string
  name: string
  entity_type: string
  summary: string
}

export type GraphEdge = {
  id: string
  src_id: string
  dst_id: string
  label: string
  weight: number
}

export type GraphSnapshot = {
  project_id: string
  nodes: Array<GraphNode>
  edges: Array<GraphEdge>
  fetched_at: string
}

export type SimulationConfig = {
  num_agents: number
  max_rounds: number
  platforms: Array<string>
  domain: string
  notes: string
}

export type CreatedSimulation = {
  simulation_id: string
  project_id: string
  prepare_task_id: string
  status: string
  config: SimulationConfig
}

export type PrepareTaskState = {
  id: string
  progress: number
  status: 'queued' | 'running' | 'completed' | 'failed' | string
  error: string | null
  target_count: number
}

export type SimulationDetail = {
  simulation_id: string
  project_id: string
  status: string
  config: SimulationConfig
  created_at: string
  prepare_task: PrepareTaskState | null
  persona_count: number
}

export type PersonaSummary = {
  id: string
  name: string
  role: string
  background: string
  bio: string
  style: string
  seed_node_id: string | null
  zep_user_id: string | null
  created_at: string
}

export type PrepareEvent =
  | {
      type: 'snapshot'
      progress: number
      status: string
      error: string | null
      target_count: number
    }
  | { type: 'phase'; phase: number; label: string }
  | {
      type: 'seed_picked'
      seeds: Array<{ name: string; entity_type: string }>
    }
  | {
      type: 'persona_ready'
      index: number
      total: number
      persona: {
        id: string
        name: string
        role: string
        background: string
        bio: string
        style: string
        seed_node_id: string | null
        seed_name: string
        seed_type: string
        zep_user_id: string | null
      }
    }
  | {
      type: 'persona_failed'
      index: number
      total: number
      seed: string
      error: string
    }
  | { type: 'done'; stats: { target: number; generated: number; failed: number } }
  | { type: 'failed'; error: string }
  | { type: 'end'; reason: string }

// --- Phase 5 — Interaction (chat + batch survey) -------------------------

export type ChatTurnResponse = {
  chat_id: string
  user_message_id: string
  assistant_message_id: string
  answer: string
}

export type ChatHistoryMessage = {
  id: string
  role: 'user' | 'assistant' | string
  content: string
  created_at: string
}

export type ChatHistoryResponse = {
  chat_id: string
  report_id: string
  mode: 'agent' | 'persona' | string
  persona_id: string | null
  title: string
  messages: Array<ChatHistoryMessage>
}

export type CreatedBatch = {
  batch_id: string
  report_id: string
  target_count: number
  status: string
}

export type BatchResponseRow = {
  id: string
  persona_id: string
  persona_name: string
  persona_role: string
  status: 'pending' | 'running' | 'completed' | 'failed' | string
  content: string
  error: string | null
}

export type BatchDetail = {
  batch_id: string
  report_id: string
  question: string
  status: 'queued' | 'running' | 'completed' | 'failed' | string
  target_count: number
  error: string | null
  created_at: string
  finished_at: string | null
  responses: Array<BatchResponseRow>
}

export type InterviewEvent =
  | { type: 'snapshot'; status: string }
  | { type: 'started'; batch_id: string; target_count: number }
  | { type: 'response_running'; persona_id: string; persona_name: string }
  | {
      type: 'response_done'
      persona_id: string
      persona_name: string
      content: string
    }
  | {
      type: 'response_failed'
      persona_id: string
      persona_name?: string
      error: string
    }
  | {
      type: 'done'
      stats: { target: number; completed: number; failed: number }
    }
  | { type: 'failed'; error: string }
  | { type: 'end'; reason: string }

// --- Phase 4 — Reports ---------------------------------------------------

export type ReportSectionRow = {
  slug: string
  title: string
  ordering: number
  status: 'pending' | 'running' | 'completed' | 'failed' | string
  content: string
  error: string | null
}

export type ReportDetail = {
  report_id: string
  simulation_id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | string
  progress: number
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  sections: Array<ReportSectionRow>
}

export type CreatedReport = {
  report_id: string
  simulation_id: string
  status: string
}

export type ReportEvent =
  | { type: 'snapshot'; status: string; progress: number; error: string | null; ts: string }
  | {
      type: 'started'
      report_id: string
      simulation_id: string
      section_slugs: Array<string>
    }
  | {
      type: 'section_start'
      slug: string
      title: string
      ordering: number
    }
  | {
      type: 'section_done'
      slug: string
      title: string
      content: string
      ordering: number
    }
  | { type: 'section_failed'; slug: string; error: string }
  | {
      type: 'done'
      stats: { total: number; completed: number; failed: number; failed_slugs: Array<string> }
    }
  | { type: 'failed'; error: string }
  | { type: 'end'; reason: string }

// --- Phase 3 — Run lifecycle ---------------------------------------------

export type RunTaskState = {
  id: string
  progress: number
  status: 'queued' | 'running' | 'completed' | 'stopped' | 'failed' | string
  error: string | null
  current_round: number
  target_rounds: number
  stop_requested: boolean
}

export type RunStartResponse = {
  simulation_id: string
  run_task_id: string
  status: string
  target_rounds: number
}

export type SimPostSummary = {
  id: string
  persona_id: string
  persona_name: string
  round_no: number
  platform: string
  parent_id: string | null
  content: string
  likes: number
  dislikes: number
  reposts: number
  created_at: string
}

export type SimActionRow = {
  id: string
  round_no: number
  persona_id: string
  persona_name: string
  platform: string
  action_type: string
  target_post_id: string | null
  post_id: string | null
  content: string | null
  created_at: string
}

export type AgentStats = {
  persona_id: string
  persona_name: string
  posts: number
  replies: number
  likes_given: number
  likes_received: number
  reposts_received: number
}

export type RunEvent =
  | {
      type: 'snapshot'
      progress: number
      status: string
      error: string | null
      current_round: number
      target_rounds: number
      stop_requested: boolean
    }
  | {
      type: 'started'
      simulation_id: string
      platforms: Array<string>
      personas: number
      max_rounds: number
    }
  | { type: 'round_start'; round_no: number; round_id: string }
  | { type: 'round_end'; round_no: number; actions: number; posts: number }
  | {
      type: 'action'
      action_id: string
      action_type: string
      platform: string
      persona_id: string
      persona_name: string
      round_no: number
      post_id: string | null
      target_post_id: string | null
      content: string | null
    }
  | { type: 'done'; stats: { actions: number; posts: number } }
  | { type: 'stopped'; round_no?: number; stats?: { actions: number; posts: number } }
  | { type: 'failed'; error: string }
  | { type: 'end'; reason: string }

export type BuildEvent =
  | { type: 'snapshot'; phase: number; progress: number; status: string; error: string | null }
  | { type: 'phase'; phase: number; label: string }
  | {
      type: 'ontology'
      domain: string
      entity_types: Array<string>
      relation_types: Array<string>
      notes: string
    }
  | {
      type: 'chunk_done'
      chunk_index: number
      doc: string
      progress: number
      nodes_total: number
      edges_total: number
    }
  | { type: 'chunk_failed'; chunk_index: number; doc: string; error: string }
  | { type: 'done'; stats: Record<string, number>; finished_at: string }
  | { type: 'failed'; phase: number; error: string }
  | { type: 'end'; reason: string }

class PredictApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'PredictApiError'
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const target = `${PROXY_BASE}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetch(target, init)
  if (!res.ok) {
    let detail = ''
    try {
      detail = await res.text()
    } catch {
      /* noop */
    }
    throw new PredictApiError(
      res.status,
      `predict-api ${res.status}: ${detail.slice(0, 240) || res.statusText}`,
    )
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const predictClient = {
  health: () => call<PredictHealth>('/healthz'),

  listProjects: (limit = 50) =>
    call<Array<ProjectSummary>>(`/api/projects?limit=${limit}`),

  listSimulations: (opts: { projectId?: string; limit?: number } = {}) => {
    const params = new URLSearchParams()
    if (opts.projectId) params.set('project_id', opts.projectId)
    if (typeof opts.limit === 'number') params.set('limit', String(opts.limit))
    const qs = params.toString()
    return call<Array<SimulationSummaryRow>>(`/api/simulations${qs ? `?${qs}` : ''}`)
  },

  listReports: (opts: { simulationId?: string; limit?: number } = {}) => {
    const params = new URLSearchParams()
    if (opts.simulationId) params.set('simulation_id', opts.simulationId)
    if (typeof opts.limit === 'number') params.set('limit', String(opts.limit))
    const qs = params.toString()
    return call<Array<ReportSummaryRow>>(`/api/reports${qs ? `?${qs}` : ''}`)
  },

  createProjectMultipart: async (files: Array<File>, prompt: string): Promise<CreatedProject> => {
    const form = new FormData()
    for (const file of files) {
      form.append('files', file, file.name)
    }
    form.append('prompt', prompt)
    return call<CreatedProject>('/api/projects', {
      method: 'POST',
      body: form,
    })
  },

  getProject: (projectId: string) =>
    call<ProjectDetail>(`/api/projects/${encodeURIComponent(projectId)}`),

  getProjectGraph: (projectId: string, limit = 200) =>
    call<GraphSnapshot>(`/api/projects/${encodeURIComponent(projectId)}/graph?limit=${limit}`),

  deleteProject: (projectId: string) =>
    call<void>(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' }),

  /**
   * Open an SSE stream for the project's build. Caller is responsible
   * for calling `close()` when the consumer unmounts/aborts.
   */
  openBuildEventStream: (projectId: string): EventSource => {
    return new EventSource(
      `${PROXY_BASE}/api/projects/${encodeURIComponent(projectId)}/build/events`,
    )
  },

  // --- Phase 2 — simulations / personas ---------------------------------

  createSimulation: (projectId: string, config: SimulationConfig) =>
    call<CreatedSimulation>('/api/simulations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, config }),
    }),

  getSimulation: (simulationId: string) =>
    call<SimulationDetail>(`/api/simulations/${encodeURIComponent(simulationId)}`),

  updateSimulationConfig: (simulationId: string, config: SimulationConfig) =>
    call<SimulationDetail>(
      `/api/simulations/${encodeURIComponent(simulationId)}/config`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config),
      },
    ),

  listPersonas: (simulationId: string, limit = 200) =>
    call<Array<PersonaSummary>>(
      `/api/simulations/${encodeURIComponent(simulationId)}/personas?limit=${limit}`,
    ),

  deleteSimulation: (simulationId: string) =>
    call<void>(`/api/simulations/${encodeURIComponent(simulationId)}`, {
      method: 'DELETE',
    }),

  /** SSE stream for the persona-prepare phase. */
  openPrepareEventStream: (simulationId: string): EventSource =>
    new EventSource(
      `${PROXY_BASE}/api/simulations/${encodeURIComponent(simulationId)}/prepare/events`,
    ),

  // --- Phase 3 — Run lifecycle -----------------------------------------

  startSimulation: (simulationId: string) =>
    call<RunStartResponse>(
      `/api/simulations/${encodeURIComponent(simulationId)}/start`,
      { method: 'POST', headers: { 'content-type': 'application/json' } },
    ),

  stopSimulation: (simulationId: string) =>
    call<RunTaskState>(
      `/api/simulations/${encodeURIComponent(simulationId)}/stop`,
      { method: 'POST', headers: { 'content-type': 'application/json' } },
    ),

  getRunStatus: (simulationId: string) =>
    call<RunTaskState | null>(
      `/api/simulations/${encodeURIComponent(simulationId)}/run-status`,
    ),

  listSimulationPosts: (
    simulationId: string,
    opts: { platform?: string; limit?: number; sinceRound?: number } = {},
  ) => {
    const params = new URLSearchParams()
    if (opts.platform) params.set('platform', opts.platform)
    if (typeof opts.limit === 'number') params.set('limit', String(opts.limit))
    if (typeof opts.sinceRound === 'number') params.set('since_round', String(opts.sinceRound))
    const qs = params.toString()
    return call<Array<SimPostSummary>>(
      `/api/simulations/${encodeURIComponent(simulationId)}/posts${qs ? `?${qs}` : ''}`,
    )
  },

  listSimulationTimeline: (
    simulationId: string,
    opts: { limit?: number; sinceRound?: number } = {},
  ) => {
    const params = new URLSearchParams()
    if (typeof opts.limit === 'number') params.set('limit', String(opts.limit))
    if (typeof opts.sinceRound === 'number') params.set('since_round', String(opts.sinceRound))
    const qs = params.toString()
    return call<Array<SimActionRow>>(
      `/api/simulations/${encodeURIComponent(simulationId)}/timeline${qs ? `?${qs}` : ''}`,
    )
  },

  listAgentStats: (simulationId: string) =>
    call<Array<AgentStats>>(
      `/api/simulations/${encodeURIComponent(simulationId)}/agent-stats`,
    ),

  /** SSE stream for the live simulation run. */
  openRunEventStream: (simulationId: string): EventSource =>
    new EventSource(
      `${PROXY_BASE}/api/simulations/${encodeURIComponent(simulationId)}/run/events`,
    ),

  // --- Phase 4 — Reports ----------------------------------------------

  createReport: (simulationId: string) =>
    call<CreatedReport>('/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ simulation_id: simulationId }),
    }),

  getReport: (reportId: string) =>
    call<ReportDetail>(`/api/reports/${encodeURIComponent(reportId)}`),

  deleteReport: (reportId: string) =>
    call<void>(`/api/reports/${encodeURIComponent(reportId)}`, { method: 'DELETE' }),

  /** SSE stream for the report-generation run. */
  openReportEventStream: (reportId: string): EventSource =>
    new EventSource(
      `${PROXY_BASE}/api/reports/${encodeURIComponent(reportId)}/events`,
    ),

  // --- Phase 5 — Chat + batch survey ----------------------------------

  postChatTurn: (
    reportId: string,
    body: {
      mode: 'agent' | 'persona'
      message: string
      chatId?: string | null
      personaId?: string | null
    },
  ) =>
    call<ChatTurnResponse>(`/api/reports/${encodeURIComponent(reportId)}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: body.mode,
        message: body.message,
        chat_id: body.chatId ?? null,
        persona_id: body.personaId ?? null,
      }),
    }),

  getChatHistory: (reportId: string, chatId: string) =>
    call<ChatHistoryResponse>(
      `/api/reports/${encodeURIComponent(reportId)}/chat/${encodeURIComponent(chatId)}`,
    ),

  createInterviewBatch: (
    reportId: string,
    body: { personaIds: Array<string>; question: string },
  ) =>
    call<CreatedBatch>(
      `/api/reports/${encodeURIComponent(reportId)}/interview/batch`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          persona_ids: body.personaIds,
          question: body.question,
        }),
      },
    ),

  getInterviewBatch: (reportId: string, batchId: string) =>
    call<BatchDetail>(
      `/api/reports/${encodeURIComponent(reportId)}/interview/batch/${encodeURIComponent(batchId)}`,
    ),

  /** SSE stream for live batch-survey progress. */
  openBatchEventStream: (reportId: string, batchId: string): EventSource =>
    new EventSource(
      `${PROXY_BASE}/api/reports/${encodeURIComponent(reportId)}/interview/batch/${encodeURIComponent(batchId)}/events`,
    ),
}

export { PredictApiError }
