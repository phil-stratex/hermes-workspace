import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { getBasename } from './_helpers'
import { usePreviewPanelStore } from '@/stores/preview-panel-store'
import { cn } from '@/lib/utils'

export function PreviewTabs() {
  const tabs = usePreviewPanelStore((state) => state.tabs)
  const activeTabId = usePreviewPanelStore((state) => state.activeTabId)
  const setActiveTab = usePreviewPanelStore((state) => state.setActiveTab)
  const closeTab = usePreviewPanelStore((state) => state.closeTab)

  if (tabs.length === 0) return null

  return (
    <div
      role="tablist"
      aria-label="Open artifacts"
      className="flex h-9 min-h-9 shrink-0 items-stretch overflow-x-auto border-b border-primary-200 bg-primary-50/80"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        const basename = getBasename(tab.path) || tab.path
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setActiveTab(tab.id)
              }
            }}
            title={`${tab.path} (v${tab.version})`}
            className={cn(
              'group relative flex min-w-0 max-w-[200px] cursor-pointer items-center gap-1.5 border-r border-primary-200 px-2.5 text-xs',
              isActive
                ? 'bg-primary-50 text-primary-950'
                : 'bg-primary-100/40 text-primary-700 hover:bg-primary-100/80',
            )}
          >
            {isActive ? (
              <span
                className="absolute inset-x-0 -bottom-px h-0.5 bg-primary-950"
                aria-hidden="true"
              />
            ) : null}
            <span className="truncate font-mono">{basename}</span>
            <span
              className={cn(
                'shrink-0 rounded border px-1 py-0.5 text-[10px] font-medium tabular-nums',
                isActive
                  ? 'border-primary-300 bg-primary-100 text-primary-700'
                  : 'border-primary-200 bg-primary-50/80 text-primary-600',
              )}
            >
              v{tab.version}
            </span>
            <button
              type="button"
              aria-label={`Close ${basename}`}
              onClick={(event) => {
                event.stopPropagation()
                closeTab(tab.id)
              }}
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded text-primary-500',
                'opacity-0 transition-opacity hover:bg-primary-200 hover:text-primary-950 group-hover:opacity-100',
                isActive && 'opacity-100',
              )}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
