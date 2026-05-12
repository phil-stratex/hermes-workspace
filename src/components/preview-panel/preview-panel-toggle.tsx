import { HugeiconsIcon } from '@hugeicons/react'
import { View01Icon } from '@hugeicons/core-free-icons'
import { usePreviewPanelStore } from '@/stores/preview-panel-store'
import { cn } from '@/lib/utils'

/**
 * Rail-style toggle that appears on the right edge of the chat-screen when
 * the PreviewPanel is closed BUT artifacts are still in the tab list. Click
 * → re-opens the panel with the previously-active tab. Mirrors the
 * DesktopPanelToggle UX so users always have one click back into a panel
 * they accidentally closed (instead of waiting for the next auto-open
 * trigger on a fresh artifact).
 *
 * Hidden when:
 *   - panel is already open (the header has its own close-X)
 *   - there are no tabs to show
 */
export function PreviewPanelToggle({ className }: { className?: string }) {
  const isPanelOpen = usePreviewPanelStore((s) => s.isPanelOpen)
  const tabsCount = usePreviewPanelStore((s) => s.tabs.length)
  const setPanelOpen = usePreviewPanelStore((s) => s.setPanelOpen)
  if (isPanelOpen) return null
  if (tabsCount === 0) return null
  return (
    <button
      type="button"
      onClick={() => setPanelOpen(true)}
      title={`Open preview panel (${tabsCount} tab${tabsCount === 1 ? '' : 's'})`}
      aria-label="Open preview panel"
      className={cn(
        'group flex items-center gap-1.5 self-start rounded-l-md border border-r-0 border-[var(--theme-border)] bg-[var(--theme-surface)]',
        'px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-muted)]',
        'shadow-md transition-colors hover:bg-[var(--theme-accent-soft)] hover:text-[var(--theme-text)]',
        className,
      )}
    >
      <HugeiconsIcon icon={View01Icon} size={14} strokeWidth={1.5} />
      <span className="hidden md:inline">Preview</span>
      {tabsCount > 1 ? (
        <span className="ml-0.5 rounded bg-[var(--theme-accent-soft)] px-1 text-[9px] tabular-nums text-[var(--theme-text)]">
          {tabsCount}
        </span>
      ) : null}
    </button>
  )
}
