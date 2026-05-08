import type { FileArtifact, FileArtifactWithContent } from './_helpers'

type ListResponse = {
  ok: boolean
  artifacts?: Array<FileArtifact>
  error?: string
}

type DetailResponse = {
  ok: boolean
  artifact?: FileArtifactWithContent
  error?: string
}

export async function fetchArtifactList(input: {
  sessionId: string
  path?: string
  limit?: number
  signal?: AbortSignal
}): Promise<Array<FileArtifact>> {
  const params = new URLSearchParams()
  params.set('sessionId', input.sessionId)
  if (input.path) params.set('path', input.path)
  if (input.limit) params.set('limit', String(input.limit))
  const res = await fetch(`/api/file-artifacts?${params.toString()}`, {
    signal: input.signal,
    headers: { accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Failed to load artifacts (${res.status})`)
  }
  const json = (await res.json()) as ListResponse
  if (!json.ok) {
    throw new Error(json.error ?? 'Failed to load artifacts')
  }
  return json.artifacts ?? []
}

export async function fetchArtifactDetail(
  artifactId: string,
  signal?: AbortSignal,
): Promise<FileArtifactWithContent> {
  const res = await fetch(
    `/api/file-artifacts/${encodeURIComponent(artifactId)}`,
    {
      signal,
      headers: { accept: 'application/json' },
    },
  )
  if (!res.ok) {
    throw new Error(`Failed to load artifact (${res.status})`)
  }
  const json = (await res.json()) as DetailResponse
  if (!json.ok || !json.artifact) {
    throw new Error(json.error ?? 'Artifact not found')
  }
  return json.artifact
}

/**
 * React-query keys. Exported so unrelated screens (e.g. chat) can invalidate
 * the artifact cache after mutations without having to know URL details.
 */
export const previewQueryKeys = {
  all: ['file-artifact'] as const,
  list: (sessionId: string, path?: string) =>
    ['file-artifact', 'list', sessionId, path ?? ''] as const,
  detail: (artifactId: string) =>
    ['file-artifact', 'detail', artifactId] as const,
}
