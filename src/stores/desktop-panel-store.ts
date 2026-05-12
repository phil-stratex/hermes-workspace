import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const DEFAULT_PANEL_WIDTH = 360
const MIN_PANEL_WIDTH = 280
const MAX_PANEL_WIDTH = 640

type DesktopPanelState = {
  /** Whether the side-panel is currently open in the chat-screen. */
  isPanelOpen: boolean
  /** Width in pixels (drag-resizable). */
  panelWidth: number
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
  setPanelWidth: (width: number) => void
}

/**
 * Lightweight Zustand store for the OpenHands Desktop side-panel that appears
 * in the chat screen. Mirrors the pattern of `usePreviewPanelStore` so users
 * get a familiar resize/persist behaviour.
 *
 * isPanelOpen intentionally NOT persisted — fresh sessions start with the
 * panel closed so the iframe + noVNC handshake only fires when needed.
 */
export const useDesktopPanelStore = create<DesktopPanelState>()(
  persist(
    (set) => ({
      isPanelOpen: false,
      panelWidth: DEFAULT_PANEL_WIDTH,
      setPanelOpen: function setPanelOpen(open: boolean) {
        set({ isPanelOpen: open })
      },
      togglePanel: function togglePanel() {
        set((state) => ({ isPanelOpen: !state.isPanelOpen }))
      },
      setPanelWidth: function setPanelWidth(width: number) {
        const clamped = Math.min(
          MAX_PANEL_WIDTH,
          Math.max(MIN_PANEL_WIDTH, Math.round(width)),
        )
        set({ panelWidth: clamped })
      },
    }),
    {
      name: 'stratex-desktop-panel',
      partialize: function partialize(state) {
        return { panelWidth: state.panelWidth }
      },
    },
  ),
)

export { DEFAULT_PANEL_WIDTH, MAX_PANEL_WIDTH, MIN_PANEL_WIDTH }
