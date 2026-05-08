import { describe, expect, it } from 'vitest'
import { initialBuildState, reduceBuildEvent } from './build-progress'
import type { BuildEvent } from '@/server/predict-client'

const clone = (s: typeof initialBuildState) =>
  JSON.parse(JSON.stringify(s)) as typeof initialBuildState

describe('reduceBuildEvent — initialBuildState', () => {
  it('starts in queued / phase 0 / progress 0 with empty defaults', () => {
    expect(initialBuildState.status).toBe('queued')
    expect(initialBuildState.phase).toBe(0)
    expect(initialBuildState.progress).toBe(0)
    expect(initialBuildState.error).toBeNull()
    expect(initialBuildState.ontology).toBeNull()
    expect(initialBuildState.nodesTotal).toBe(0)
    expect(initialBuildState.edgesTotal).toBe(0)
    expect(initialBuildState.lastChunkDoc).toBeNull()
    expect(initialBuildState.lastChunkFailureDoc).toBeNull()
    expect(initialBuildState.lastChunkFailureError).toBeNull()
    expect(initialBuildState.recentEvents).toEqual([])
  })
})

describe('reduceBuildEvent — events', () => {
  it('snapshot — populates phase, progress, status, and error', () => {
    const ev: BuildEvent = {
      type: 'snapshot',
      phase: 1,
      progress: 0.42,
      status: 'running',
      error: null,
    }
    const next = reduceBuildEvent(initialBuildState, ev)
    expect(next.phase).toBe(1)
    expect(next.progress).toBeCloseTo(0.42)
    expect(next.status).toBe('running')
    expect(next.error).toBeNull()
    expect(next.recentEvents).toHaveLength(1)
    expect(next.recentEvents[0]).toEqual(ev)
  })

  it('snapshot — coerces missing error to null', () => {
    const ev = {
      type: 'snapshot',
      phase: 0,
      progress: 0,
      status: 'queued',
    } as unknown as BuildEvent
    const next = reduceBuildEvent(initialBuildState, ev)
    expect(next.error).toBeNull()
  })

  it('phase — updates phase, leaves other fields untouched', () => {
    const prev = {
      ...initialBuildState,
      progress: 0.5,
      status: 'running',
      nodesTotal: 7,
    }
    const ev: BuildEvent = { type: 'phase', phase: 2, label: 'fertig' }
    const next = reduceBuildEvent(prev, ev)
    expect(next.phase).toBe(2)
    expect(next.progress).toBe(0.5)
    expect(next.status).toBe('running')
    expect(next.nodesTotal).toBe(7)
  })

  it('ontology — populates ontology fields', () => {
    const ev: BuildEvent = {
      type: 'ontology',
      domain: 'fintech',
      entity_types: ['Bank', 'Customer'],
      relation_types: ['has_account', 'transferred_to'],
      notes: 'auto-derived',
    }
    const next = reduceBuildEvent(initialBuildState, ev)
    expect(next.ontology).toEqual({
      domain: 'fintech',
      entityTypes: ['Bank', 'Customer'],
      relationTypes: ['has_account', 'transferred_to'],
      notes: 'auto-derived',
    })
  })

  it('chunk_done — updates progress, totals, and lastChunkDoc', () => {
    const ev: BuildEvent = {
      type: 'chunk_done',
      chunk_index: 3,
      doc: 'spec.pdf',
      progress: 0.75,
      nodes_total: 120,
      edges_total: 320,
    }
    const next = reduceBuildEvent(initialBuildState, ev)
    expect(next.progress).toBeCloseTo(0.75)
    expect(next.nodesTotal).toBe(120)
    expect(next.edgesTotal).toBe(320)
    expect(next.lastChunkDoc).toBe('spec.pdf')
  })

  it('chunk_failed — sets lastChunkFailureDoc / lastChunkFailureError', () => {
    const ev: BuildEvent = {
      type: 'chunk_failed',
      chunk_index: 5,
      doc: 'corrupt.pdf',
      error: 'parse-error',
    }
    const next = reduceBuildEvent(initialBuildState, ev)
    expect(next.lastChunkDoc).toBe('corrupt.pdf')
    expect(next.lastChunkFailureDoc).toBe('corrupt.pdf')
    expect(next.lastChunkFailureError).toBe('parse-error')
  })

  it('done — flips status to completed, progress to 1, phase to 2', () => {
    const prev = { ...initialBuildState, phase: 1, progress: 0.6, status: 'running' }
    const ev: BuildEvent = {
      type: 'done',
      stats: { nodes: 10 },
      finished_at: '2026-05-08T10:00:00Z',
    }
    const next = reduceBuildEvent(prev, ev)
    expect(next.status).toBe('completed')
    expect(next.progress).toBe(1)
    expect(next.phase).toBe(2)
  })

  it('failed — sets status=failed and propagates error', () => {
    const ev: BuildEvent = {
      type: 'failed',
      phase: 1,
      error: 'timeout',
    }
    const next = reduceBuildEvent(initialBuildState, ev)
    expect(next.status).toBe('failed')
    expect(next.error).toBe('timeout')
  })

  it('end — leaves the state object identical (no-op)', () => {
    const prev = { ...initialBuildState, progress: 0.3, status: 'running' }
    const ev: BuildEvent = { type: 'end', reason: 'eof' }
    const next = reduceBuildEvent(prev, ev)
    expect(next).toBe(prev)
  })

  it('unknown event types fall through the default branch and keep state', () => {
    const prev = { ...initialBuildState, progress: 0.4, status: 'running' }
    const ev = { type: 'totally-not-a-real-event' } as unknown as BuildEvent
    const next = reduceBuildEvent(prev, ev)
    expect(next).toBe(prev)
    // 'reset' is hook-level; reducer must not crash on it either.
    const reset = { type: 'reset' } as unknown as BuildEvent
    expect(() => reduceBuildEvent(prev, reset)).not.toThrow()
    expect(reduceBuildEvent(prev, reset)).toBe(prev)
  })

  it('caps recentEvents at 20 (rolling window)', () => {
    let s = initialBuildState
    for (let i = 0; i < 25; i++) {
      s = reduceBuildEvent(s, { type: 'phase', phase: 0, label: `p${i}` })
    }
    expect(s.recentEvents.length).toBe(20)
    // The oldest 5 events should have been dropped.
    expect((s.recentEvents[0] as { label: string }).label).toBe('p5')
    expect(
      (s.recentEvents[s.recentEvents.length - 1] as { label: string }).label,
    ).toBe('p24')
  })
})

describe('reduceBuildEvent — immutability', () => {
  it('does not mutate the previous state object', () => {
    const prev = clone(initialBuildState)
    const before = clone(prev)
    reduceBuildEvent(prev, {
      type: 'chunk_done',
      chunk_index: 1,
      doc: 'a.pdf',
      progress: 0.1,
      nodes_total: 1,
      edges_total: 2,
    })
    // prev unchanged structurally
    expect(prev).toEqual(before)
  })

  it('returns a new state object reference for state-changing events', () => {
    const prev = { ...initialBuildState }
    const next = reduceBuildEvent(prev, {
      type: 'phase',
      phase: 1,
      label: 'Wissensgraph',
    })
    expect(next).not.toBe(prev)
  })
})
