// @vitest-environment jsdom
/**
 * Tests for useBuildProgress.
 *
 * EventSource is stubbed via vi.stubGlobal so we can drive events
 * synchronously inside React.act() and verify both the reducer integration
 * and the reset-on-projectId-change effect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'

// ---------------------------------------------------------------------------
// EventSource fake — captures listeners + lets tests fire events.
// ---------------------------------------------------------------------------

type Listener = (ev: MessageEvent<string>) => void

class FakeEventSource {
  static instances: Array<FakeEventSource> = []
  url: string
  listeners = new Map<string, Set<Listener>>()
  closed = false
  onerror: ((this: FakeEventSource, ev: Event) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }

  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn)
  }

  emit(type: string, payload: unknown) {
    const ev = new MessageEvent(type, { data: JSON.stringify(payload) })
    for (const fn of this.listeners.get(type) ?? []) fn(ev)
  }

  close() {
    this.closed = true
  }
}

// Mock the predict client so openBuildEventStream returns our fake.
vi.mock('@/server/predict-client', () => ({
  predictClient: {
    openBuildEventStream: (projectId: string) =>
      new FakeEventSource(`/build/${projectId}`),
  },
}))

import { useBuildProgress } from './use-build-progress'
import type { BuildState } from '../components/build-progress'

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type HarnessProps = {
  projectId: string | null
  stateRef: { current: BuildState | null }
  connectionRef: { current: string | null }
}

function Harness({ projectId, stateRef, connectionRef }: HarnessProps) {
  const { state, connection } = useBuildProgress(projectId)
  stateRef.current = state
  connectionRef.current = connection
  return null
}

type Mounted = {
  rerender: (props: HarnessProps) => Promise<void>
  unmount: () => Promise<void>
}

async function mountHook(initial: HarnessProps): Promise<Mounted> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  const renderWith = (props: HarnessProps) =>
    React.createElement(Harness, props)
  await React.act(async () => {
    root.render(renderWith(initial))
  })
  return {
    rerender: async (props) => {
      await React.act(async () => {
        root.render(renderWith(props))
      })
    },
    unmount: async () => {
      await React.act(async () => {
        root.unmount()
      })
      document.body.removeChild(container)
    },
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  FakeEventSource.instances = []
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBuildProgress — initial state', () => {
  it('returns initialBuildState and idle connection when projectId is null', async () => {
    const stateRef: { current: BuildState | null } = { current: null }
    const connectionRef: { current: string | null } = { current: null }
    const { unmount } = await mountHook({
      projectId: null,
      stateRef,
      connectionRef,
    })
    expect(stateRef.current?.status).toBe('queued')
    expect(stateRef.current?.phase).toBe(0)
    expect(stateRef.current?.progress).toBe(0)
    expect(connectionRef.current).toBe('idle')
    expect(FakeEventSource.instances.length).toBe(0)
    await unmount()
  })

  it('opens an EventSource and transitions to connecting when projectId is set', async () => {
    const stateRef: { current: BuildState | null } = { current: null }
    const connectionRef: { current: string | null } = { current: null }
    const { unmount } = await mountHook({
      projectId: 'p-1',
      stateRef,
      connectionRef,
    })
    expect(FakeEventSource.instances.length).toBe(1)
    expect(FakeEventSource.instances[0].url).toContain('p-1')
    expect(connectionRef.current).toBe('connecting')
    await unmount()
  })
})

describe('useBuildProgress — event integration', () => {
  it('feeds incoming chunk_done events through the reducer', async () => {
    const stateRef: { current: BuildState | null } = { current: null }
    const connectionRef: { current: string | null } = { current: null }
    const { unmount } = await mountHook({
      projectId: 'p-1',
      stateRef,
      connectionRef,
    })
    const src = FakeEventSource.instances[0]

    await React.act(async () => {
      src.emit('chunk_done', {
        type: 'chunk_done',
        chunk_index: 1,
        doc: 'a.pdf',
        progress: 0.5,
        nodes_total: 10,
        edges_total: 20,
      })
    })

    expect(stateRef.current?.progress).toBeCloseTo(0.5)
    expect(stateRef.current?.nodesTotal).toBe(10)
    expect(stateRef.current?.edgesTotal).toBe(20)
    expect(stateRef.current?.lastChunkDoc).toBe('a.pdf')

    await unmount()
  })

  it('flips status to completed on done event', async () => {
    const stateRef: { current: BuildState | null } = { current: null }
    const connectionRef: { current: string | null } = { current: null }
    const { unmount } = await mountHook({
      projectId: 'p-1',
      stateRef,
      connectionRef,
    })
    const src = FakeEventSource.instances[0]

    await React.act(async () => {
      src.emit('done', { type: 'done', stats: {}, finished_at: 'now' })
    })

    expect(stateRef.current?.status).toBe('completed')
    expect(stateRef.current?.progress).toBe(1)
    expect(stateRef.current?.phase).toBe(2)

    await unmount()
  })
})

describe('useBuildProgress — reset on projectId change', () => {
  it('resets state to initial when projectId changes', async () => {
    const stateRef: { current: BuildState | null } = { current: null }
    const connectionRef: { current: string | null } = { current: null }
    const { rerender, unmount } = await mountHook({
      projectId: 'p-A',
      stateRef,
      connectionRef,
    })
    const srcA = FakeEventSource.instances[0]

    // Pile up state under project A.
    await React.act(async () => {
      srcA.emit('snapshot', {
        type: 'snapshot',
        phase: 1,
        progress: 0.4,
        status: 'running',
        error: null,
      })
    })
    expect(stateRef.current?.status).toBe('running')
    expect(stateRef.current?.progress).toBeCloseTo(0.4)
    expect(stateRef.current?.phase).toBe(1)

    // Switch projectId — the effect should dispatch {type:'reset'} and open a
    // fresh EventSource. State must collapse back to initial defaults.
    await rerender({ projectId: 'p-B', stateRef, connectionRef })

    expect(srcA.closed).toBe(true)
    expect(FakeEventSource.instances.length).toBe(2)
    expect(FakeEventSource.instances[1].url).toContain('p-B')
    expect(stateRef.current?.status).toBe('queued')
    expect(stateRef.current?.progress).toBe(0)
    expect(stateRef.current?.phase).toBe(0)
    expect(stateRef.current?.recentEvents).toEqual([])

    await unmount()
  })

  it('closes the EventSource on unmount', async () => {
    const stateRef: { current: BuildState | null } = { current: null }
    const connectionRef: { current: string | null } = { current: null }
    const { unmount } = await mountHook({
      projectId: 'p-1',
      stateRef,
      connectionRef,
    })
    const src = FakeEventSource.instances[0]
    await unmount()
    expect(src.closed).toBe(true)
  })
})

describe('useBuildProgress — error handling', () => {
  it('marks connection=closed instead of error after a terminal status', async () => {
    const stateRef: { current: BuildState | null } = { current: null }
    const connectionRef: { current: string | null } = { current: null }
    const { unmount } = await mountHook({
      projectId: 'p-1',
      stateRef,
      connectionRef,
    })
    const src = FakeEventSource.instances[0]

    // Simulate the open transition then completion + a benign disconnect.
    await React.act(async () => {
      const openListeners = src.listeners.get('open')
      openListeners?.forEach((fn) => fn(new MessageEvent('open', { data: '' })))
      src.emit('done', { type: 'done', stats: {}, finished_at: 'now' })
    })
    await React.act(async () => {
      src.onerror?.call(src, new Event('error'))
    })

    expect(stateRef.current?.status).toBe('completed')
    expect(connectionRef.current).toBe('closed')

    await unmount()
  })
})
