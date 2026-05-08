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
}

export { PredictApiError }
