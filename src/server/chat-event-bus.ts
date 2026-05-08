import { hasActiveSendRun } from './send-run-tracker'

export interface ChatSSEEvent {
  event: string
  data: Record<string, unknown>
}

type ChatSSESubscriber = (event: ChatSSEEvent) => void

// ─── Singleton state (survives Vite HMR via globalThis) ─────────────────

const BUS_KEY = '__claude_chat_event_bus__' as const

// Hard cap so a leaked SSE handler (forgotten cleanup, runaway client reconnect
// loop) cannot grow the subscriber set without bound. Each subscriber is a
// closure over a Response stream — at ~1 KB/closure plus the per-event fan-out
// cost, an unbounded set would silently turn into a memory + CPU regression.
const MAX_SUBSCRIBERS = 200

interface BusState {
  subscribers: Set<ChatSSESubscriber>
  started: boolean
}

function getBus(): BusState {
  if (!(globalThis as any)[BUS_KEY]) {
    ;(globalThis as any)[BUS_KEY] = {
      subscribers: new Set<ChatSSESubscriber>(),
      started: false,
    }
  }
  return (globalThis as any)[BUS_KEY]
}

function broadcast(event: string, data: Record<string, unknown>): void {
  const bus = getBus()
  const evt: ChatSSEEvent = { event, data }
  for (const sub of bus.subscribers) {
    try {
      sub(evt)
    } catch {
      // subscriber error — don't crash the bus
    }
  }
}

export function publishChatEvent(
  event: string,
  data: Record<string, unknown>,
): void {
  const runId = typeof data.runId === 'string' ? data.runId : undefined
  if (hasActiveSendRun(runId)) return
  broadcast(event, data)
}

export async function ensureBusStarted(): Promise<void> {
  const bus = getBus()
  if (bus.started) return
  bus.started = true
}

export function subscribeToChatEvents(
  subscriber: ChatSSESubscriber,
  sessionKeyFilter?: string,
): () => void {
  const bus = getBus()

  if (bus.subscribers.size >= MAX_SUBSCRIBERS) {
    console.warn(
      `[chat-event-bus] subscriber cap reached (${MAX_SUBSCRIBERS}); rejecting new subscription`,
    )
    return () => {}
  }

  // Wrap subscriber with session key filter if provided
  const wrappedSubscriber: ChatSSESubscriber = sessionKeyFilter
    ? (event) => {
        const eventSessionKey = event.data.sessionKey as string | undefined
        if (eventSessionKey && eventSessionKey !== sessionKeyFilter) return
        const runId =
          typeof event.data.runId === 'string' ? event.data.runId : undefined
        if (hasActiveSendRun(runId)) return
        subscriber(event)
      }
    : (event) => {
        const runId =
          typeof event.data.runId === 'string' ? event.data.runId : undefined
        if (hasActiveSendRun(runId)) return
        subscriber(event)
      }

  bus.subscribers.add(wrappedSubscriber)
  return () => {
    bus.subscribers.delete(wrappedSubscriber)
  }
}
