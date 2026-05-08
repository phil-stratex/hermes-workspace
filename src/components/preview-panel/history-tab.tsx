import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchArtifactList, previewQueryKeys } from './_api'
import {
  formatFileSize,
  formatRelativeTime,
  getKindAccent,
  getKindLabel,
} from './_helpers'
import { usePreviewPanelStore } from '@/stores/preview-panel-store'
import { cn } from '@/lib/utils'

type HistoryTabProps = {
  sessionId: string
  path: string
  activeTabId: string
  activeVersion: number
}

const HISTORY_LIMIT = 100

export function HistoryTab({
  sessionId,
  path,
  activeTabId,
  activeVersion,
}: HistoryTabProps) {
  const updateTabVersion = usePreviewPanelStore(
    (state) => state.updateTabVersion,
  )
  const setViewMode = usePreviewPanelStore((state) => state.setViewMode)

  const historyQuery = useQuery({
    queryKey: previewQueryKeys.list(sessionId, path),
    queryFn: ({ signal }) =>
      fetchArtifactList({ sessionId, path, limit: HISTORY_LIMIT, signal }),
    enabled: Boolean(sessionId && path),
    staleTime: 15_000,
  })

  const sortedVersions = useMemo(() => {
    const list = historyQuery.data ?? []
    return [...list].sort((a, b) => b.version - a.version)
  }, [historyQuery.data])

  const latestVersion = sortedVersions[0]?.version ?? 0

  if (historyQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-primary-500">
        Loading history…
      </div>
    )
  }

  if (historyQuery.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-sm text-red-600">Failed to load history</p>
        <p className="text-xs text-primary-500">
          {historyQuery.error instanceof Error
            ? historyQuery.error.message
            : 'Unknown error'}
        </p>
      </div>
    )
  }

  if (sortedVersions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-primary-500">
        No version history available for this file.
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 overflow-auto bg-primary-50/50">
      <ul className="divide-y divide-primary-200">
        {sortedVersions.map((artifact) => {
          const isActive = artifact.version === activeVersion
          const isLatest = artifact.version === latestVersion
          const accent = getKindAccent(artifact.kind)
          return (
            <li
              key={artifact.id}
              className={cn(
                'flex flex-col gap-1.5 px-4 py-3 transition-colors',
                isActive ? 'bg-primary-100/80' : 'hover:bg-primary-100/40',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
                    accent.border,
                    accent.text,
                  )}
                >
                  v{artifact.version}
                </span>
                {isLatest ? (
                  <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                    Latest
                  </span>
                ) : null}
                <span className="text-xs text-primary-700">
                  {formatRelativeTime(artifact.createdAt)}
                </span>
                <span
                  className={cn(
                    'text-[10px] font-medium uppercase tracking-wide',
                    accent.text,
                  )}
                >
                  {getKindLabel(artifact.kind)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-primary-600">
                <span className="font-mono">{artifact.toolName}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {formatFileSize(artifact.contentSize)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isActive}
                  onClick={() => {
                    updateTabVersion(
                      activeTabId,
                      artifact.id,
                      artifact.version,
                      artifact.toolName,
                      artifact.kind,
                    )
                    setViewMode(activeTabId, 'code')
                  }}
                  className={cn(
                    'inline-flex h-7 items-center rounded-md border border-primary-200 bg-primary-50 px-2 text-xs font-medium text-primary-800',
                    'transition-colors hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-60',
                  )}
                >
                  {isActive ? 'Viewing' : 'View'}
                </button>
                {!isLatest ? (
                  <button
                    type="button"
                    onClick={() => {
                      updateTabVersion(
                        activeTabId,
                        artifact.id,
                        artifact.version,
                        artifact.toolName,
                        artifact.kind,
                      )
                      setViewMode(activeTabId, 'diff')
                    }}
                    className={cn(
                      'inline-flex h-7 items-center rounded-md border border-primary-200 bg-primary-50 px-2 text-xs font-medium text-primary-800',
                      'transition-colors hover:bg-primary-100',
                    )}
                  >
                    Diff vs latest
                  </button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
