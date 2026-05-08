/**
 * Client-side state for the Predict feature.
 *
 * The store carries two pieces of state that don't live anywhere else:
 *  - `pendingUpload` is the files+prompt cache between the home-screen
 *    submit and the build-screen first render — POSTing the multipart
 *    happens on the build-screen so we can show progress immediately.
 *  - `recentProjects` is a tiny client-side breadcrumb list so the home
 *    history grid has something to show before /api/projects/list is
 *    wired up server-side (phase 6 polish).
 *
 * Persisted slice = `recentProjects` only. The pending-upload payload
 * carries File objects (not serialisable) so it stays in-memory.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type PendingUpload = {
  files: Array<File>
  prompt: string
}

export type RecentProject = {
  projectId: string
  prompt: string
  documentNames: Array<string>
  createdAt: number
  status: 'queued' | 'running' | 'completed' | 'failed' | 'unknown'
}

type PredictState = {
  pendingUpload: PendingUpload | null
  setPendingUpload: (next: PendingUpload | null) => void
  recentProjects: Array<RecentProject>
  upsertRecent: (entry: RecentProject) => void
  removeRecent: (projectId: string) => void
}

const persistedPart = (state: PredictState) => ({
  recentProjects: state.recentProjects,
})

export const usePredictStore = create<PredictState>()(
  persist(
    (set) => ({
      pendingUpload: null,
      setPendingUpload: (pendingUpload) => set({ pendingUpload }),
      recentProjects: [],
      upsertRecent: (entry) =>
        set((state) => {
          const filtered = state.recentProjects.filter((p) => p.projectId !== entry.projectId)
          return { recentProjects: [entry, ...filtered].slice(0, 20) }
        }),
      removeRecent: (projectId) =>
        set((state) => ({
          recentProjects: state.recentProjects.filter((p) => p.projectId !== projectId),
        })),
    }),
    {
      name: 'predict-store',
      partialize: persistedPart as never,
    },
  ),
)
