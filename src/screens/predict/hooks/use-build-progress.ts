import { useEffect, useReducer, useRef, useState } from 'react'
import type { BuildEvent } from '@/server/predict-client'
import { predictClient } from '@/server/predict-client'
import {
  initialBuildState,
  reduceBuildEvent,
  type BuildState,
} from '../components/build-progress'

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export function useBuildProgress(projectId: string | null): {
  state: BuildState
  connection: ConnectionState
  reconnect: () => void
} {
  const [state, dispatch] = useReducer(
    (s: BuildState, ev: BuildEvent): BuildState => {
      if ((ev as { type: string }).type === 'reset') return initialBuildState
      return reduceBuildEvent(s, ev)
    },
    initialBuildState,
  )
  const [connection, setConnection] = useState<ConnectionState>('idle')
  const [generation, setGeneration] = useState(0)

  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    if (!projectId) {
      setConnection('idle')
      return
    }
    dispatch({ type: 'reset' } as never)
    setConnection('connecting')
    const source = predictClient.openBuildEventStream(projectId)

    source.addEventListener('open', () => setConnection('open'))

    const handleEvent = (kind: string) => (raw: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(raw.data) as BuildEvent
        // Server sends typed events; keep `type` consistent if missing.
        if (!('type' in parsed) || typeof parsed.type !== 'string') {
          ;(parsed as { type: string }).type = kind
        }
        dispatch(parsed)
      } catch {
        /* swallow malformed event */
      }
    }
    const eventTypes = [
      'snapshot',
      'phase',
      'ontology',
      'chunk_done',
      'chunk_failed',
      'done',
      'failed',
      'end',
    ] as const
    for (const kind of eventTypes) {
      source.addEventListener(kind, handleEvent(kind) as EventListener)
    }

    source.onerror = () => {
      // EventSource auto-reconnects unless we close it. We surface the
      // 'error' state for the UI badge but keep the connection open.
      // F-M5: After a terminal status, Cloudflare/proxies will close the
      // idle SSE — that's a normal close, not an error.
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
  }, [projectId, generation])

  return {
    state,
    connection,
    reconnect: () => setGeneration((g) => g + 1),
  }
}
