import { useEffect, useReducer, useRef, useState } from 'react'
import type { RunEvent } from '@/server/predict-client'
import { predictClient } from '@/server/predict-client'

export type ActionTickerEntry = {
  id: string
  ts: number
  personaName: string
  platform: string
  action: string
  postId: string | null
  targetPostId: string | null
  content: string | null
  roundNo: number
}

export type RunProgressState = {
  status: 'idle' | 'queued' | 'running' | 'completed' | 'stopped' | 'failed' | string
  error: string | null
  currentRound: number
  targetRounds: number
  stopRequested: boolean
  actionsTotal: number
  postsTotal: number
  tickers: Array<ActionTickerEntry>
  perPlatformActions: Record<string, number>
  perPlatformPosts: Record<string, number>
}

const initial: RunProgressState = {
  status: 'idle',
  error: null,
  currentRound: 0,
  targetRounds: 0,
  stopRequested: false,
  actionsTotal: 0,
  postsTotal: 0,
  tickers: [],
  perPlatformActions: {},
  perPlatformPosts: {},
}

function reduceRunEvent(state: RunProgressState, event: RunEvent): RunProgressState {
  if ((event as { type: string }).type === 'reset') return initial
  switch (event.type) {
    case 'snapshot':
      return {
        ...state,
        status: event.status,
        error: event.error ?? null,
        currentRound: event.current_round,
        targetRounds: event.target_rounds,
        stopRequested: event.stop_requested,
      }
    case 'started':
      return {
        ...state,
        status: 'running',
        targetRounds: event.max_rounds,
      }
    case 'round_start':
      return { ...state, currentRound: event.round_no, status: 'running' }
    case 'round_end':
      return {
        ...state,
        actionsTotal: event.actions,
        postsTotal: event.posts,
      }
    case 'action': {
      const ticker: ActionTickerEntry = {
        id: event.action_id,
        ts: Date.now(),
        personaName: event.persona_name,
        platform: event.platform,
        action: event.action_type,
        postId: event.post_id,
        targetPostId: event.target_post_id,
        content: event.content,
        roundNo: event.round_no,
      }
      const tickers = [ticker, ...state.tickers].slice(0, 30)
      const perPlatformActions = {
        ...state.perPlatformActions,
        [event.platform]: (state.perPlatformActions[event.platform] ?? 0) + 1,
      }
      const perPlatformPosts =
        event.post_id != null
          ? {
              ...state.perPlatformPosts,
              [event.platform]: (state.perPlatformPosts[event.platform] ?? 0) + 1,
            }
          : state.perPlatformPosts
      return {
        ...state,
        actionsTotal: state.actionsTotal + 1,
        postsTotal: event.post_id != null ? state.postsTotal + 1 : state.postsTotal,
        tickers,
        perPlatformActions,
        perPlatformPosts,
      }
    }
    case 'done':
      return {
        ...state,
        status: 'completed',
        actionsTotal: event.stats.actions,
        postsTotal: event.stats.posts,
      }
    case 'stopped':
      return {
        ...state,
        status: 'stopped',
        actionsTotal: event.stats?.actions ?? state.actionsTotal,
        postsTotal: event.stats?.posts ?? state.postsTotal,
      }
    case 'failed':
      return { ...state, status: 'failed', error: event.error }
    case 'end':
      return state
    default:
      return state
  }
}

export type RunConnection = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export function useRunProgress(simulationId: string | null): {
  state: RunProgressState
  connection: RunConnection
  reconnect: () => void
} {
  const [state, dispatch] = useReducer(reduceRunEvent, initial)
  const [connection, setConnection] = useState<RunConnection>('idle')
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
    let source: EventSource
    try {
      source = predictClient.openRunEventStream(simulationId)
    } catch {
      setConnection('error')
      return
    }
    source.addEventListener('open', () => setConnection('open'))

    const handler = (kind: string) => (raw: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(raw.data) as RunEvent
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
      'round_start',
      'round_end',
      'action',
      'done',
      'stopped',
      'failed',
      'end',
    ] as const
    for (const kind of eventTypes) {
      source.addEventListener(kind, handler(kind) as EventListener)
    }

    source.onerror = () => {
      const s = stateRef.current.status
      if (s === 'completed' || s === 'failed' || s === 'stopped') {
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
    reconnect: () => setGeneration((g) => g + 1),
  }
}
