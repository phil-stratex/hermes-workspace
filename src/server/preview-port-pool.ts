/**
 * Preview port pool.
 *
 * Allocates dev-server ports from a fixed range so the workspace proxy
 * route can reach a project's `pnpm dev` running inside the hermes-agent
 * container. State is persisted to a JSON file so allocations survive a
 * workspace restart, and an in-process async mutex serialises mutations
 * so concurrent allocate/release calls don't tear the file. Cross-process
 * safety is best-effort (atomic rename) — single-process is the common
 * case here since only the Workspace-Container manages this pool.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeJsonAtomic } from './atomic-write'

const PORT_RANGE_START = 4001
const PORT_RANGE_END = 4020

const STATE_FILE = join(process.cwd(), '.runtime', 'preview-ports.json')

export type PortAllocation = {
  port: number
  runId: string
  projectDir: string
  allocatedAt: number
}

type PortState = {
  allocations: Array<PortAllocation>
}

export class PortPoolExhaustedError extends Error {
  readonly allocations: Array<PortAllocation>
  constructor(allocations: Array<PortAllocation>) {
    const summary = allocations
      .map((a) => `${a.port}->${a.runId} (${a.projectDir})`)
      .join(', ')
    super(
      `Preview port pool exhausted (range ${PORT_RANGE_START}-${PORT_RANGE_END}). Active: ${summary || 'none'}`,
    )
    this.name = 'PortPoolExhaustedError'
    this.allocations = allocations
  }
}

type GlobalLock = {
  __previewPortLock?: Promise<unknown>
}

function getLockHolder(): GlobalLock {
  return globalThis as unknown as GlobalLock
}

async function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const holder = getLockHolder()
  const previous = holder.__previewPortLock ?? Promise.resolve()
  const next = previous.then(
    () => fn(),
    () => fn(),
  )
  holder.__previewPortLock = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function ensureStateDir(): void {
  const dir = dirname(STATE_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function readState(): PortState {
  try {
    if (!existsSync(STATE_FILE)) return { allocations: [] }
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as PortState
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive: disk could hold null/array/primitive
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.allocations)) {
      return parsed
    }
    return { allocations: [] }
  } catch {
    return { allocations: [] }
  }
}

function writeState(state: PortState): void {
  ensureStateDir()
  writeJsonAtomic(STATE_FILE, state)
}

export async function allocatePort(
  runId: string,
  projectDir: string,
): Promise<number> {
  return withLock(() => {
    const state = readState()
    const taken = new Set(state.allocations.map((a) => a.port))
    for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
      if (!taken.has(port)) {
        const alloc: PortAllocation = {
          port,
          runId,
          projectDir,
          allocatedAt: Date.now(),
        }
        state.allocations.push(alloc)
        writeState(state)
        return port
      }
    }
    throw new PortPoolExhaustedError(state.allocations)
  })
}

export async function releasePort(port: number): Promise<void> {
  await withLock(() => {
    const state = readState()
    const next = state.allocations.filter((a) => a.port !== port)
    if (next.length === state.allocations.length) return
    writeState({ allocations: next })
  })
}

export async function listAllocations(): Promise<Array<PortAllocation>> {
  return withLock(() => {
    const state = readState()
    return state.allocations.slice()
  })
}

export const PREVIEW_PORT_RANGE = {
  start: PORT_RANGE_START,
  end: PORT_RANGE_END,
} as const
