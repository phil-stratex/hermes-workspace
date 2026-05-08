import { useMemo } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchArtifactDetail,
  fetchArtifactList,
  previewQueryKeys,
} from './_api'
import { getLanguageFromPath } from './_helpers'
import { useResolvedTheme } from '@/hooks/use-chat-settings'

type DiffViewProps = {
  artifactId: string
  sessionId: string
  path: string
  version: number
}

const HISTORY_LIMIT = 50

export function DiffView({
  artifactId,
  sessionId,
  path,
  version,
}: DiffViewProps) {
  const resolvedTheme = useResolvedTheme()
  const language = useMemo(() => getLanguageFromPath(path), [path])

  const currentQuery = useQuery({
    queryKey: previewQueryKeys.detail(artifactId),
    queryFn: ({ signal }) => fetchArtifactDetail(artifactId, signal),
    enabled: Boolean(artifactId),
    staleTime: 60_000,
  })

  const historyQuery = useQuery({
    queryKey: previewQueryKeys.list(sessionId, path),
    queryFn: ({ signal }) =>
      fetchArtifactList({ sessionId, path, limit: HISTORY_LIMIT, signal }),
    enabled: Boolean(sessionId && path),
    staleTime: 30_000,
  })

  const previousArtifactId = useMemo(() => {
    const list = historyQuery.data ?? []
    let bestId: string | null = null
    let bestVersion = -Infinity
    for (const artifact of list) {
      if (artifact.version < version && artifact.version > bestVersion) {
        bestVersion = artifact.version
        bestId = artifact.id
      }
    }
    return bestId
  }, [historyQuery.data, version])

  const previousQuery = useQuery({
    queryKey: previewQueryKeys.detail(previousArtifactId ?? ''),
    queryFn: ({ signal }) =>
      fetchArtifactDetail(previousArtifactId ?? '', signal),
    enabled: Boolean(previousArtifactId),
    staleTime: 60_000,
  })

  const isLoading =
    currentQuery.isLoading ||
    historyQuery.isLoading ||
    (Boolean(previousArtifactId) && previousQuery.isLoading)

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-primary-500">
        Loading diff…
      </div>
    )
  }

  if (currentQuery.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-sm text-red-600">Failed to load diff</p>
        <p className="text-xs text-primary-500">
          {currentQuery.error instanceof Error
            ? currentQuery.error.message
            : 'Unknown error'}
        </p>
      </div>
    )
  }

  const modified = currentQuery.data?.content ?? ''
  const original = previousQuery.data?.content ?? ''
  const isFirstVersion = !previousArtifactId

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-50">
      {isFirstVersion ? (
        <div className="border-b border-primary-200 bg-primary-100/60 px-3 py-1.5 text-[11px] text-primary-600">
          First recorded version — no prior content to diff against.
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <DiffEditor
          height="100%"
          language={language === 'text' ? 'plaintext' : language}
          original={original}
          modified={modified}
          theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs-light'}
          options={{
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            renderOverviewRuler: false,
            fontSize: 12,
          }}
        />
      </div>
    </div>
  )
}
