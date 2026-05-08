import { useCallback, useMemo } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { CodeView } from './code-view'
import { DiffView } from './diff-view'
import { HistoryTab } from './history-tab'
import { IframeView } from './iframe-view'
import { MarkdownView } from './markdown-view'
import { PreviewTabs } from './preview-tabs'
import { RunAppTab } from './run-app-tab'
import { ViewModeSwitcher } from './view-mode-switcher'
import { isHtmlPath, isMarkdownPath } from './_helpers'
import { cn } from '@/lib/utils'
import {
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  usePreviewPanelStore,
} from '@/stores/preview-panel-store'

function ResizeHandle({
  onResizeStart,
}: {
  onResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize preview panel"
      onMouseDown={onResizeStart}
      className={cn(
        'absolute inset-y-0 left-0 w-1 cursor-col-resize',
        'bg-primary-200/40 transition-colors hover:bg-primary-300/80',
      )}
    />
  )
}

export function PreviewPanel() {
  const isPanelOpen = usePreviewPanelStore((state) => state.isPanelOpen)
  const panelWidth = usePreviewPanelStore((state) => state.panelWidth)
  const tabs = usePreviewPanelStore((state) => state.tabs)
  const activeTabId = usePreviewPanelStore((state) => state.activeTabId)
  const setPanelWidth = usePreviewPanelStore((state) => state.setPanelWidth)
  const togglePanel = usePreviewPanelStore((state) => state.togglePanel)

  const handleResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()

      function onMove(moveEvent: MouseEvent) {
        const viewportCap = Math.min(
          window.innerWidth * 0.6,
          MAX_PANEL_WIDTH,
        )
        const next = Math.min(
          viewportCap,
          Math.max(MIN_PANEL_WIDTH, window.innerWidth - moveEvent.clientX),
        )
        setPanelWidth(next)
      }

      function onUp() {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        // Defense-in-depth: a `pointercancel` (alt-tab mid-drag, OS-level
        // gesture) won't fire mouseup, so we listen for both and tear down
        // here regardless of which one ends the drag.
        window.removeEventListener('pointercancel', onUp)
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
      }

      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'col-resize'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [setPanelWidth],
  )

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId],
  )

  if (!isPanelOpen || tabs.length === 0) return null

  return (
    <aside
      aria-label="Artifact preview panel"
      className={cn(
        'relative flex h-full shrink-0 flex-col overflow-hidden border-l border-primary-200',
        'bg-primary-50 text-primary-900',
      )}
      style={{ width: panelWidth }}
    >
      <ResizeHandle onResizeStart={handleResizeStart} />
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-primary-200 bg-primary-50/80 pl-3 pr-1">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary-700">
          Preview
        </div>
        <button
          type="button"
          aria-label="Close preview panel"
          onClick={togglePanel}
          className={cn(
            'flex size-7 items-center justify-center rounded-md text-primary-500',
            'transition-colors hover:bg-primary-200 hover:text-primary-950',
          )}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
        </button>
      </div>
      <PreviewTabs />
      <ViewModeSwitcher />
      <div className="flex min-h-0 flex-1 flex-col">
        <PreviewBody />
      </div>
    </aside>
  )
}

function PreviewBody() {
  const tabs = usePreviewPanelStore((state) => state.tabs)
  const activeTabId = usePreviewPanelStore((state) => state.activeTabId)

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId],
  )

  if (tabs.length === 0) return null

  // Run-mode short-circuits the extension-based branches: this is a project
  // dev-server view, not a single-file renderer. The Run button only appears
  // for `package.json` tabs (see view-mode-switcher), so reaching this branch
  // means the user explicitly asked to run the project.
  if (activeTab.viewMode === 'run') {
    return <RunAppTab tab={activeTab} />
  }

  if (activeTab.viewMode === 'history') {
    return (
      <HistoryTab
        sessionId={activeTab.sessionId}
        path={activeTab.path}
        activeTabId={activeTab.id}
        activeVersion={activeTab.version}
      />
    )
  }

  if (activeTab.viewMode === 'diff') {
    return (
      <DiffView
        artifactId={activeTab.artifactId}
        sessionId={activeTab.sessionId}
        path={activeTab.path}
        version={activeTab.version}
      />
    )
  }

  if (activeTab.viewMode === 'preview') {
    if (isMarkdownPath(activeTab.path)) {
      return <MarkdownView artifactId={activeTab.artifactId} />
    }
    if (isHtmlPath(activeTab.path)) {
      return <IframeView artifactId={activeTab.artifactId} />
    }
  }

  return <CodeView artifactId={activeTab.artifactId} path={activeTab.path} />
}
