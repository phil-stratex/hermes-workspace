import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
  ArrowExpand01Icon,
} from '@hugeicons/core-free-icons'
import { useDesktopPanelStore } from '@/stores/desktop-panel-store'
import { DesktopVncIframe } from './desktop-vnc-iframe'
import { cn } from '@/lib/utils'

/**
 * Right-side resizable Desktop preview panel for the chat-screen. Mirrors the
 * pattern of `<PreviewPanel />` but shows a live noVNC view of the OpenHands
 * sandbox so Phil can glance at what workers are doing on the desktop without
 * leaving the chat.
 *
 * Open/close toggled via `useDesktopPanelStore.togglePanel()`. Width persists
 * to localStorage; `isPanelOpen` is session-scoped so fresh sessions don't
 * eagerly open the iframe.
 */
export function DesktopPanel() {
  const isPanelOpen = useDesktopPanelStore((s) => s.isPanelOpen)
  const panelWidth = useDesktopPanelStore((s) => s.panelWidth)
  const setPanelOpen = useDesktopPanelStore((s) => s.setPanelOpen)
  const setPanelWidth = useDesktopPanelStore((s) => s.setPanelWidth)

  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    if (!dragging) return
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current) return
      const dx = dragRef.current.startX - e.clientX
      setPanelWidth(dragRef.current.startWidth + dx)
    }
    function onMouseUp() {
      setDragging(false)
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [dragging, setPanelWidth])

  if (!isPanelOpen) return null

  return (
    <aside
      className={cn(
        'relative flex h-full flex-col border-l border-[var(--theme-border)] bg-[var(--theme-surface)]',
        'min-w-[280px] max-w-[640px]',
      )}
      style={{ width: panelWidth }}
      aria-label="Desktop preview panel"
    >
      {/* Resize handle on left edge */}
      <div
        role="separator"
        aria-orientation="vertical"
        tabIndex={-1}
        onMouseDown={(e) => {
          dragRef.current = { startX: e.clientX, startWidth: panelWidth }
          setDragging(true)
        }}
        className={cn(
          'absolute -left-0.5 top-0 z-10 h-full w-1 cursor-col-resize',
          'transition-colors hover:bg-[var(--theme-accent)]/50',
          dragging && 'bg-[var(--theme-accent)]/50',
        )}
      />
      <header className="flex items-center justify-between border-b border-[var(--theme-border)] px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-muted)]">
          Desktop
        </span>
        <div className="flex items-center gap-1">
          <Link
            to="/desktop"
            title="In Vollbild öffnen"
            className="rounded-md p-1.5 text-[var(--theme-muted)] transition-colors hover:bg-[var(--theme-accent-soft)] hover:text-[var(--theme-text)]"
          >
            <HugeiconsIcon icon={ArrowExpand01Icon} size={14} strokeWidth={1.5} />
          </Link>
          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            title="Panel schließen"
            aria-label="Close desktop panel"
            className="rounded-md p-1.5 text-[var(--theme-muted)] transition-colors hover:bg-[var(--theme-accent-soft)] hover:text-[var(--theme-text)]"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.5} />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 p-2">
        <DesktopVncIframe size="mini" className="rounded-md shadow-inner" />
      </div>
    </aside>
  )
}
