import { useCallback, useMemo, useState } from 'react'
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
  isResizing,
}: {
  onResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void
  isResizing: boolean
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize preview panel"
      tabIndex={0}
      onMouseDown={onResizeStart}
      // Stratex: previously a 4px transparent strip — users couldn't see it
      // and missed the resize affordance. Now a 6px visible strip with a
      // centred grip indicator + wide invisible hit-area (8px on each side
      // via padding) so the cursor catches the col-resize comfortably.
      className={cn(
        'group absolute inset-y-0 -left-2 z-20 flex w-5 cursor-col-resize items-center justify-center',
        'select-none',
      )}
    >
      {/* visible vertical bar */}
      <span
        className={cn(
          'block h-12 w-[3px] rounded-full transition-colors',
          isResizing
            ? 'bg-[var(--theme-accent)]'
            : 'bg-primary-300/80 group-hover:bg-primary-500',
        )}
      />
      {/* full-height tinted edge to communicate the panel boundary */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 left-2 w-px transition-colors',
          isResizing
            ? 'bg-[var(--theme-accent)]'
            : 'bg-primary-300/60 group-hover:bg-primary-400',
        )}
      />
    </div>
  )
}

export function PreviewPanel() {
  const isPanelOpen = usePreviewPanelStore((state) => state.isPanelOpen)
  const panelWidth = usePreviewPanelStore((state) => state.panelWidth)
  const tabs = usePreviewPanelStore((state) => state.tabs)
  const activeTabId = usePreviewPanelStore((state) => state.activeTabId)
  const setPanelWidth = usePreviewPanelStore((state) => state.setPanelWidth)
  const togglePanel = usePreviewPanelStore((state) => state.togglePanel)

  const [isResizing, setIsResizing] = useState(false)

  const handleResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      setIsResizing(true)

      function onMove(moveEvent: MouseEvent) {
        const viewportCap = Math.min(
          window.innerWidth * 0.85, // Stratex: allow up to 85% viewport so HTML dashboards have room to breathe
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
        setIsResizing(false)
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
      <ResizeHandle onResizeStart={handleResizeStart} isResizing={isResizing} />
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
