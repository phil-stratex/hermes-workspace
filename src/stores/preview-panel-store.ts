import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { FileArtifactKind } from './chat-store'

const DEFAULT_PANEL_WIDTH = 480
const MIN_PANEL_WIDTH = 320
const MAX_PANEL_WIDTH = 900

export type PreviewViewMode = 'code' | 'preview' | 'diff' | 'history' | 'run'

export type PreviewTab = {
  id: string
  artifactId: string
  sessionId: string
  path: string
  toolName?: string
  kind?: FileArtifactKind
  version: number
  viewMode: PreviewViewMode
  createdAt: number
}

type OpenArtifactInput = {
  artifactId: string
  sessionId: string
  path: string
  version: number
  toolName?: string
}

type PreviewPanelState = {
  isPanelOpen: boolean
  panelWidth: number
  tabs: Array<PreviewTab>
  activeTabId: string
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
  setPanelWidth: (width: number) => void
  openArtifact: (input: OpenArtifactInput) => void
  closeTab: (tabId: string) => void
  closeAllTabs: () => void
  setActiveTab: (tabId: string) => void
  setViewMode: (tabId: string, mode: PreviewViewMode) => void
  updateTabVersion: (
    tabId: string,
    artifactId: string,
    version: number,
    toolName?: string,
    kind?: FileArtifactKind,
  ) => void
}

export const usePreviewPanelStore = create<PreviewPanelState>()(
  persist(
    (set, get) => ({
      isPanelOpen: false,
      panelWidth: DEFAULT_PANEL_WIDTH,
      tabs: [],
      activeTabId: '',
      setPanelOpen: function setPanelOpen(open: boolean) {
        set({ isPanelOpen: open })
      },
      togglePanel: function togglePanel() {
        set((state) => {
          if (state.tabs.length === 0) {
            return { isPanelOpen: false }
          }
          return { isPanelOpen: !state.isPanelOpen }
        })
      },
      setPanelWidth: function setPanelWidth(width: number) {
        const clamped = Math.min(
          MAX_PANEL_WIDTH,
          Math.max(MIN_PANEL_WIDTH, Math.round(width)),
        )
        set({ panelWidth: clamped })
      },
      openArtifact: function openArtifact(input: OpenArtifactInput) {
        set((state) => {
          const existing = state.tabs.find(
            (tab) =>
              tab.sessionId === input.sessionId && tab.path === input.path,
          )
          if (existing) {
            const nextTabs = state.tabs.map((tab) =>
              tab.id === existing.id
                ? {
                    ...tab,
                    artifactId: input.artifactId,
                    version: input.version,
                    toolName: input.toolName,
                  }
                : tab,
            )
            return {
              tabs: nextTabs,
              activeTabId: existing.id,
              isPanelOpen: true,
            }
          }
          const newTab: PreviewTab = {
            id: crypto.randomUUID(),
            artifactId: input.artifactId,
            sessionId: input.sessionId,
            path: input.path,
            toolName: input.toolName,
            version: input.version,
            viewMode: 'code',
            createdAt: Date.now(),
          }
          return {
            tabs: [...state.tabs, newTab],
            activeTabId: newTab.id,
            isPanelOpen: true,
          }
        })
      },
      closeTab: function closeTab(tabId: string) {
        set((state) => {
          const nextTabs = state.tabs.filter((tab) => tab.id !== tabId)
          if (nextTabs.length === 0) {
            return {
              tabs: [],
              activeTabId: '',
              isPanelOpen: false,
            }
          }
          if (state.activeTabId === tabId) {
            return {
              tabs: nextTabs,
              activeTabId: nextTabs[nextTabs.length - 1].id,
            }
          }
          return { tabs: nextTabs }
        })
      },
      closeAllTabs: function closeAllTabs() {
        set({ tabs: [], activeTabId: '', isPanelOpen: false })
      },
      setActiveTab: function setActiveTab(tabId: string) {
        const exists = get().tabs.some((tab) => tab.id === tabId)
        if (!exists) return
        set({ activeTabId: tabId })
      },
      setViewMode: function setViewMode(tabId: string, mode: PreviewViewMode) {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, viewMode: mode } : tab,
          ),
        }))
      },
      updateTabVersion: function updateTabVersion(
        tabId: string,
        artifactId: string,
        version: number,
        toolName?: string,
        kind?: FileArtifactKind,
      ) {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId
              ? {
                  ...tab,
                  artifactId,
                  version,
                  ...(toolName !== undefined ? { toolName } : {}),
                  ...(kind !== undefined ? { kind } : {}),
                }
              : tab,
          ),
        }))
      },
    }),
    {
      name: 'preview-panel-state',
      // isPanelOpen intentionally omitted — fresh sessions start with the panel closed.
      partialize: function partialize(state) {
        return {
          panelWidth: state.panelWidth,
          tabs: state.tabs,
          activeTabId: state.activeTabId,
        }
      },
      onRehydrateStorage: function onRehydrateStorage() {
        return function onHydrated(state) {
          if (!state) return
          if (state.tabs.length === 0) {
            state.activeTabId = ''
            return
          }
          const activeExists = state.tabs.some(
            (tab) => tab.id === state.activeTabId,
          )
          if (!activeExists) {
            state.activeTabId = state.tabs[state.tabs.length - 1].id
          }
        }
      },
    },
  ),
)

export { DEFAULT_PANEL_WIDTH, MAX_PANEL_WIDTH, MIN_PANEL_WIDTH }
