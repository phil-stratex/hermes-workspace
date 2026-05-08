import type { RegisteredProject, RunningPreview } from './_runner-types'

type StartResponse = {
  ok: boolean
  run?: RunningPreview
  error?: string
}

type StopResponse = {
  ok: boolean
  error?: string
}

type StatusResponse = {
  ok: boolean
  run?: RunningPreview | null
  error?: string
}

type ListResponse = {
  ok: boolean
  runs?: Array<RunningPreview>
  error?: string
}

type LogsResponse = {
  ok: boolean
  logs?: string
  runId?: string
  error?: string
}

type ProjectsResponse = {
  ok: boolean
  projects?: Array<RegisteredProject>
  error?: string
}

export async function fetchRegisteredProjects(
  sessionId?: string,
  signal?: AbortSignal,
): Promise<Array<RegisteredProject>> {
  const params = new URLSearchParams()
  if (sessionId) params.set('sessionId', sessionId)
  const query = params.toString()
  const url = `/api/preview-projects${query ? `?${query}` : ''}`
  const res = await fetch(url, {
    signal,
    headers: { accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Failed to load registered projects (${res.status})`)
  }
  const json = (await res.json()) as ProjectsResponse
  if (!json.ok) {
    throw new Error(json.error ?? 'Failed to load registered projects')
  }
  return json.projects ?? []
}

export async function fetchRunningPreviews(
  signal?: AbortSignal,
): Promise<Array<RunningPreview>> {
  const res = await fetch('/api/preview-runner/list', {
    signal,
    headers: { accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Failed to list running previews (${res.status})`)
  }
  const json = (await res.json()) as ListResponse
  if (!json.ok) {
    throw new Error(json.error ?? 'Failed to list running previews')
  }
  return json.runs ?? []
}

export async function fetchPreviewStatus(
  runId: string,
  signal?: AbortSignal,
): Promise<RunningPreview | null> {
  const params = new URLSearchParams({ runId })
  const res = await fetch(`/api/preview-runner/status?${params.toString()}`, {
    signal,
    headers: { accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch preview status (${res.status})`)
  }
  const json = (await res.json()) as StatusResponse
  if (!json.ok) {
    throw new Error(json.error ?? 'Failed to fetch preview status')
  }
  return json.run ?? null
}

export async function fetchPreviewLogs(
  runId: string,
  tail: number = 200,
  signal?: AbortSignal,
): Promise<string> {
  const params = new URLSearchParams({ runId, tail: String(tail) })
  const res = await fetch(`/api/preview-runner/logs?${params.toString()}`, {
    signal,
    headers: { accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch preview logs (${res.status})`)
  }
  const json = (await res.json()) as LogsResponse
  if (!json.ok) {
    throw new Error(json.error ?? 'Failed to fetch preview logs')
  }
  return json.logs ?? ''
}

export async function startPreview(input: {
  projectDirRelative: string
  sessionId?: string
}): Promise<RunningPreview> {
  const res = await fetch('/api/preview-runner/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    // Try to surface a server-provided error message before falling back to
    // the HTTP status — matches the pattern in `_api.ts`.
    let serverMessage: string | undefined
    try {
      const json = (await res.json()) as StartResponse
      serverMessage = json.error
    } catch {
      // ignore parse error
    }
    throw new Error(
      serverMessage ?? `Failed to start preview (${res.status})`,
    )
  }
  const json = (await res.json()) as StartResponse
  if (!json.ok || !json.run) {
    throw new Error(json.error ?? 'Failed to start preview')
  }
  return json.run
}

export async function stopPreview(runId: string): Promise<void> {
  const res = await fetch('/api/preview-runner/stop', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ runId }),
  })
  if (!res.ok) {
    throw new Error(`Failed to stop preview (${res.status})`)
  }
  const json = (await res.json()) as StopResponse
  if (!json.ok) {
    throw new Error(json.error ?? 'Failed to stop preview')
  }
}

/**
 * React-query keys for runner state. Mirrors `previewQueryKeys` in `_api.ts`
 * so unrelated screens can invalidate runner caches without knowing URLs.
 */
export const runnerQueryKeys = {
  all: ['preview-runner'] as const,
  projects: (sessionId?: string) =>
    ['preview-runner', 'projects', sessionId ?? ''] as const,
  list: () => ['preview-runner', 'list'] as const,
  status: (runId: string) =>
    ['preview-runner', 'status', runId] as const,
  logs: (runId: string, tail: number) =>
    ['preview-runner', 'logs', runId, tail] as const,
}
