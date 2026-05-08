import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CodeIcon,
  GitCompareIcon,
  PlayIcon,
  Time04Icon,
  ViewIcon,
} from '@hugeicons/core-free-icons'
import { getBasename, isHtmlPath, isMarkdownPath } from './_helpers'
import { fetchArtifactDetail, previewQueryKeys } from './_api'
import type { PreviewViewMode } from '@/stores/preview-panel-store'
import { usePreviewPanelStore } from '@/stores/preview-panel-store'
import { cn } from '@/lib/utils'

type ModeDescriptor = {
  mode: PreviewViewMode
  label: string
  icon: typeof CodeIcon
}

const ALL_MODES: Array<ModeDescriptor> = [
  { mode: 'code', label: 'Code', icon: CodeIcon },
  { mode: 'preview', label: 'Preview', icon: ViewIcon },
  { mode: 'run', label: 'Run', icon: PlayIcon },
  { mode: 'diff', label: 'Diff', icon: GitCompareIcon },
  { mode: 'history', label: 'History', icon: Time04Icon },
]

/**
 * MVP rule: the "Run" mode is only available when the active tab points at a
 * `package.json`. The future enhancement is to also enable it when there's a
 * registered project whose dir is a parent of the tab path — deferred for now
 * to keep the UI deterministic and the backend contract minimal.
 */
function supportsRun(path: string): boolean {
  return getBasename(path).toLowerCase() === 'package.json'
}

function buildAvailableModes(
  path: string,
  hasDiff: boolean,
): Array<ModeDescriptor> {
  const supportsPreview = isMarkdownPath(path) || isHtmlPath(path)
  const runnable = supportsRun(path)
  return ALL_MODES.filter((entry) => {
    if (entry.mode === 'preview') return supportsPreview
    if (entry.mode === 'diff') return hasDiff
    if (entry.mode === 'run') return runnable
    return true
  })
}

export function ViewModeSwitcher() {
  const tabs = usePreviewPanelStore((state) => state.tabs)
  const activeTabId = usePreviewPanelStore((state) => state.activeTabId)
  const setViewMode = usePreviewPanelStore((state) => state.setViewMode)

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId),
    [tabs, activeTabId],
  )

  const artifactQuery = useQuery({
    queryKey: previewQueryKeys.detail(activeTab?.artifactId ?? ''),
    queryFn: ({ signal }) =>
      fetchArtifactDetail(activeTab?.artifactId ?? '', signal),
    enabled: Boolean(activeTab?.artifactId),
    staleTime: 30_000,
  })

  if (!activeTab) return null

  const hasDiff = Boolean(artifactQuery.data?.diff)
  const modes = buildAvailableModes(activeTab.path, hasDiff)

  return (
    <div
      role="toolbar"
      aria-label="View mode"
      className="flex h-9 shrink-0 items-center gap-1 border-b border-primary-200 bg-primary-50/60 px-2"
    >
      {modes.map((entry) => {
        const isActive = activeTab.viewMode === entry.mode
        return (
          <button
            key={entry.mode}
            type="button"
            aria-pressed={isActive}
            onClick={() => setViewMode(activeTab.id, entry.mode)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
              isActive
                ? 'bg-primary-950 text-primary-50 shadow-sm'
                : 'text-primary-700 hover:bg-primary-100 hover:text-primary-950',
            )}
          >
            <HugeiconsIcon icon={entry.icon} size={14} strokeWidth={1.5} />
            {entry.label}
          </button>
        )
      })}
    </div>
  )
}
