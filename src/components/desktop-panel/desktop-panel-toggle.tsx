import { HugeiconsIcon } from '@hugeicons/react'
import { ComputerDesk01Icon } from '@hugeicons/core-free-icons'
import { useDesktopPanelStore } from '@/stores/desktop-panel-store'
import { cn } from '@/lib/utils'

/**
 * Tiny rail-style toggle that appears on the right edge of the chat-screen
 * when the DesktopPanel is closed. Click → open the live-VNC mini-panel.
 *
 * Hidden while the panel is already open (header has its own close-button).
 */
export function DesktopPanelToggle({ className }: { className?: string }) {
  const isPanelOpen = useDesktopPanelStore((s) => s.isPanelOpen)
  const setPanelOpen = useDesktopPanelStore((s) => s.setPanelOpen)
  if (isPanelOpen) return null
  return (
    <button
      type="button"
      onClick={() => setPanelOpen(true)}
      title="Open Hermes Desktop preview"
      aria-label="Open Hermes Desktop preview"
      className={cn(
        'group flex items-center gap-1.5 self-start rounded-l-md border border-r-0 border-[var(--theme-border)] bg-[var(--theme-surface)]',
        'px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-muted)]',
        'shadow-md transition-colors hover:bg-[var(--theme-accent-soft)] hover:text-[var(--theme-text)]',
        className,
      )}
    >
      <HugeiconsIcon icon={ComputerDesk01Icon} size={14} strokeWidth={1.5} />
      <span className="hidden md:inline">Desktop</span>
    </button>
  )
}
