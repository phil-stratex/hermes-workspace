/**
 * Types for the Project-Runner feature (Phase 2).
 *
 * These mirror the shape returned by the `/api/preview-runner/*` endpoints
 * implemented by the backend agent in parallel. Keeping them colocated with
 * the preview panel avoids a server-module import for components that only
 * need the surface contract.
 */

export type RunnerFramework =
  | 'next'
  | 'vite'
  | 'astro'
  | 'sveltekit'
  | 'cra'
  | 'static'
  | 'unknown'

export type RunnerStatus =
  | 'installing'
  | 'starting'
  | 'ready'
  | 'error'
  | 'stopped'

export type RunningPreview = {
  runId: string
  projectDir: string
  projectDirRelative: string
  framework: RunnerFramework
  port: number
  status: RunnerStatus
  pid?: number
  logsPath: string
  errorMessage?: string
  startedAt: number
  /** URL prefix that the iframe should load. Always begins with `/preview/`. */
  basePath: string
}

export type RegisteredProject = {
  id: string
  sessionId: string
  projectDirRelative: string
  framework: RunnerFramework
  registeredAt: number
}
