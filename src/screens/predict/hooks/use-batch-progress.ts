import { useEffect, useReducer, useRef, useState } from 'react'
import type { InterviewEvent } from '@/server/predict-client'
import { predictClient } from '@/server/predict-client'

export type BatchProgressEntry = {
  personaId: string
  personaName: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  content: string
  error: string | null
}

export type BatchProgressState = {
  status: 'idle' | 'queued' | 'running' | 'completed' | 'failed' | string
  error: string | null
  targetCount: number
  responsesById: Record<string, BatchProgressEntry>
}

const initial: BatchProgressState = {
  status: 'idle',
  error: null,
  targetCount: 0,
  responsesById: {},
}

function patch(state: BatchProgressState, key: string, fields: Partial<BatchProgressEntry>): BatchProgressState {
  const existing: BatchProgressEntry = state.responsesById[key] ?? {
    personaId: key,
    personaName: '?',
    status: 'pending',
    content: '',
    error: null,
  }
  return {
    ...state,
    responsesById: {
      ...state.responsesById,
      [key]: { ...existing, ...fields },
    },
  }
}

function reduceBatchEvent(state: BatchProgressState, event: InterviewEvent): BatchProgressState {
  if ((event as { type: string }).type === 'reset') return initial
  switch (event.type) {
    case 'snapshot':
      return { ...state, status: event.status }
    case 'started':
      return { ...state, status: 'running', targetCount: event.target_count }
    case 'response_running':
      return patch(state, event.persona_id, {
        personaId: event.persona_id,
        personaName: event.persona_name,
        status: 'running',
      })
    case 'response_done':
      return patch(state, event.persona_id, {
        personaId: event.persona_id,
        personaName: event.persona_name,
        status: 'completed',
        content: event.content,
      })
    case 'response_failed':
      return patch(state, event.persona_id, {
        personaId: event.persona_id,
        personaName: event.persona_name ?? '?',
        status: 'failed',
        error: event.error,
      })
    case 'done':
      return {
        ...state,
        status: 'completed',
        targetCount: event.stats.target,
      }
    case 'failed':
      return { ...state, status: 'failed', error: event.error }
    case 'end':
      return state
    default:
      return state
  }
}

export type BatchConnection = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export function useBatchProgress(reportId: string | null, batchId: string | null): {
  state: BatchProgressState
  connection: BatchConnection
  reconnect: () => void
} {
  const [state, dispatch] = useReducer(reduceBatchEvent, initial)
  const [connection, setConnection] = useState<BatchConnection>('idle')
  const [generation, setGeneration] = useState(0)

  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    if (!reportId || !batchId) {
      setConnection('idle')
      return
    }
    dispatch({ type: 'reset' } as never)
    setConnection('connecting')
    const source = predictClient.openBatchEventStream(reportId, batchId)
    source.addEventListener('open', () => setConnection('open'))
    const handler = (kind: string) => (raw: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(raw.data) as InterviewEvent
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
      'started',
      'response_running',
      'response_done',
      'response_failed',
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
  }, [reportId, batchId, generation])

  return {
    state,
    connection,
    reconnect: () => setGeneration((g) => g + 1),
  }
}
