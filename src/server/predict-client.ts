/**
 * Browser-side client for the Stratex Predict API.
 *
 * All requests go through `/api/predict-proxy/<path>` so the bearer
 * token stays server-side. Phase 0 covers healthz + the three stub
 * resource creators; Phase 1+ adds typed wrappers for the real
 * endpoints (uploads, SSE consumers, persona stream, etc.).
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

export type ProjectStub = {
  project_id: string
  build_task_id: string
  status: string
  created_at: string
}

export type SimulationStub = {
  simulation_id: string
  project_id: string
  status: string
  created_at: string
}

export type ReportStub = {
  report_id: string
  simulation_id: string
  status: string
  created_at: string
}

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
  return (await res.json()) as T
}

export const predictClient = {
  health: () => call<PredictHealth>('/healthz'),
  createProject: () =>
    call<ProjectStub>('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }),
  getProject: (projectId: string) => call<ProjectStub>(`/api/projects/${encodeURIComponent(projectId)}`),
  createSimulation: (projectId: string) =>
    call<SimulationStub>(
      `/api/simulations?project_id=${encodeURIComponent(projectId)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      },
    ),
  createReport: (simulationId: string) =>
    call<ReportStub>(
      `/api/reports?simulation_id=${encodeURIComponent(simulationId)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      },
    ),
}

export { PredictApiError }
