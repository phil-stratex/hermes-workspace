import { useEffect, useReducer, useRef, useState } from 'react'
import type { PrepareEvent } from '@/server/predict-client'
import { predictClient } from '@/server/predict-client'

export type PreparedPersona = {
  id: string
  name: string
  role: string
  background: string
  bio: string
  style: string
  seedNodeId: string | null
  seedName: string | null
  seedType: string | null
}

export type PrepareProgressState = {
  progress: number
  status: 'idle' | 'queued' | 'running' | 'completed' | 'failed' | string
  error: string | null
  targetCount: number
  generatedCount: number
  failedCount: number
  seeds: Array<{ name: string; entityType: string }>
  personas: Array<PreparedPersona>
  lastFailureSeed: string | null
}

const initialState: PrepareProgressState = {
  progress: 0,
  status: 'idle',
  error: null,
  targetCount: 0,
  generatedCount: 0,
  failedCount: 0,
  seeds: [],
  personas: [],
  lastFailureSeed: null,
}

function reducePrepare(state: PrepareProgressState, event: PrepareEvent): PrepareProgressState {
  if ((event as { type: string }).type === 'reset') return initialState
  switch (event.type) {
    case 'snapshot':
      return {
        ...state,
        progress: event.progress,
        status: event.status,
        error: event.error ?? null,
        targetCount: event.target_count,
      }
    case 'phase':
      return state
    case 'seed_picked':
      return {
        ...state,
        seeds: event.seeds.map((s) => ({ name: s.name, entityType: s.entity_type })),
      }
    case 'persona_ready': {
      const persona: PreparedPersona = {
        id: event.persona.id,
        name: event.persona.name,
        role: event.persona.role,
        background: event.persona.background,
        bio: event.persona.bio,
        style: event.persona.style,
        seedNodeId: event.persona.seed_node_id ?? null,
        seedName: event.persona.seed_name ?? null,
        seedType: event.persona.seed_type ?? null,
      }
      return {
        ...state,
        progress: event.total > 0 ? (event.index + 1) / event.total : state.progress,
        targetCount: event.total,
        generatedCount: state.generatedCount + 1,
        personas: [...state.personas, persona],
      }
    }
    case 'persona_failed':
      return {
        ...state,
        targetCount: event.total,
        failedCount: state.failedCount + 1,
        lastFailureSeed: event.seed,
        progress: event.total > 0 ? (event.index + 1) / event.total : state.progress,
      }
    case 'done':
      return {
        ...state,
        progress: 1,
        status: 'completed',
        targetCount: event.stats.target,
        generatedCount: event.stats.generated,
        failedCount: event.stats.failed,
      }
    case 'failed':
      return { ...state, status: 'failed', error: event.error }
    case 'end':
      return state
    default:
      return state
  }
}

export type PrepareConnection = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export function usePrepareProgress(simulationId: string | null): {
  state: PrepareProgressState
  connection: PrepareConnection
  reset: () => void
} {
  const [state, dispatch] = useReducer(reducePrepare, initialState)
  const [connection, setConnection] = useState<PrepareConnection>('idle')
  const [generation, setGeneration] = useState(0)

  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    if (!simulationId) {
      setConnection('idle')
      return
    }
    dispatch({ type: 'reset' } as never)
    setConnection('connecting')
    const source = predictClient.openPrepareEventStream(simulationId)
    source.addEventListener('open', () => setConnection('open'))

    const handler = (kind: string) => (raw: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(raw.data) as PrepareEvent
        if (!('type' in parsed) || typeof parsed.type !== 'string') {
          ;(parsed as { type: string }).type = kind
        }
        dispatch(parsed)
      } catch {
        /* swallow */
      }
    }
    const eventTypes = [
      'snapshot',
      'phase',
      'seed_picked',
      'persona_ready',
      'persona_failed',
      'done',
      'failed',
      'end',
    ] as const
    for (const kind of eventTypes) {
      source.addEventListener(kind, handler(kind) as EventListener)
    }
    source.onerror = () => {
      const s = stateRef.current.status
      if (s === 'completed' || s === 'failed') {
        setConnection('closed')
        return
      }
      setConnection((current) => (current === 'open' ? 'error' : current))
    }
    return () => {
      source.close()
      setConnection('closed')
    }
  }, [simulationId, generation])

  return {
    state,
    connection,
    reset: () => setGeneration((g) => g + 1),
  }
}
