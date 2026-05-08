/**
 * Client-side state for the Predict feature.
 *
 * Carries only `pendingUpload` — the files+prompt cache between the
 * home-screen submit and the build-screen first render. POSTing the
 * multipart happens on the build-screen so we can show progress
 * immediately. The payload contains File objects (not serialisable)
 * so this slice stays in-memory only — no `persist` wrapper.
 */

import { create } from 'zustand'

export type PendingUpload = {
  files: Array<File>
  prompt: string
}

type PredictState = {
  pendingUpload: PendingUpload | null
  setPendingUpload: (next: PendingUpload | null) => void
}

export const usePredictStore = create<PredictState>()((set) => ({
  pendingUpload: null,
  setPendingUpload: (pendingUpload) => set({ pendingUpload }),
}))
