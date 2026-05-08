import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  predictClient,
  type ChatHistoryMessage,
} from '@/server/predict-client'

export type ChatThreadState = {
  chatId: string | null
  messages: Array<ChatHistoryMessage>
  busy: boolean
  error: string | null
}

const EMPTY: ChatThreadState = {
  chatId: null,
  messages: [],
  busy: false,
  error: null,
}

export type ChatThreadHandle = ChatThreadState & {
  send: (text: string) => Promise<void>
  reset: () => void
}

/**
 * useChatThread — keyed chat thread state container.
 *
 * Fixes:
 *  - F-H1: state lives in this hook (which the parent owns), so tab-switch
 *    doesn't unmount the state.
 *  - F-H2: `chatIdRef` is updated synchronously from inside `send()` after
 *    the await, so subsequent rapid `send()` calls always read the freshest
 *    `chat_id` even before React commits the matching state update.
 *  - F-M1: state is keyed by `(mode, personaId)`, so each persona's busy /
 *    messages live independently — switching personas no longer leaks busy
 *    or echoes a streaming reply into the wrong thread.
 *
 * The hook keeps an internal `Record<key, ChatThreadState>` so a single
 * hook instance handles every persona — avoiding the "hooks in loops"
 * rule. Only the active key's state is exposed via the returned handle.
 */
export function useChatThread(
  reportId: string,
  mode: 'agent' | 'persona',
  personaId?: string | null,
): ChatThreadHandle {
  const key = mode === 'agent' ? 'agent' : `persona:${personaId ?? ''}`
  const isReady = mode === 'agent' || !!personaId

  const [threadsByKey, setThreadsByKey] = useState<Record<string, ChatThreadState>>({})
  const chatIdRefByKey = useRef<Record<string, string | null>>({})
  const rehydratedKeysRef = useRef<Set<string>>(new Set())
  const queryClient = useQueryClient()

  const current = threadsByKey[key] ?? EMPTY

  const updateThread = useCallback(
    (k: string, updater: (prev: ChatThreadState) => ChatThreadState) => {
      setThreadsByKey((prev) => {
        const previous = prev[k] ?? EMPTY
        const next = updater(previous)
        if (next === previous) return prev
        return { ...prev, [k]: next }
      })
    },
    [],
  )

  // Rehydrate via TanStack Query if a chatId is known but messages are empty.
  useEffect(() => {
    if (!isReady) return
    const knownChatId = chatIdRefByKey.current[key] ?? current.chatId
    if (!knownChatId) return
    if (current.messages.length > 0) return
    if (rehydratedKeysRef.current.has(key)) return
    rehydratedKeysRef.current.add(key)
    let cancelled = false
    queryClient
      .fetchQuery({
        queryKey: ['predict', 'chat-history', reportId, knownChatId],
        queryFn: () => predictClient.getChatHistory(reportId, knownChatId),
      })
      .then((history) => {
        if (cancelled) return
        updateThread(key, (prev) => ({
          ...prev,
          chatId: history.chat_id,
          messages: history.messages,
        }))
        chatIdRefByKey.current[key] = history.chat_id
      })
      .catch(() => {
        // Best-effort rehydrate; allow a future retry.
        rehydratedKeysRef.current.delete(key)
      })
    return () => {
      cancelled = true
    }
  }, [isReady, key, reportId, current.chatId, current.messages.length, queryClient, updateThread])

  const send = useCallback(
    async (text: string) => {
      if (!isReady) return
      const sendKey = key
      const sendPersonaId = mode === 'persona' ? personaId ?? null : null
      // F-LOW2: Date.now() can collide if two messages fire within the same ms,
      // causing duplicate React keys. crypto.randomUUID() is collision-free.
      const userId = `temp-user-${crypto.randomUUID()}`
      const optimistic: ChatHistoryMessage = {
        id: userId,
        role: 'user',
        content: text,
        created_at: new Date().toISOString(),
      }
      updateThread(sendKey, (prev) => ({
        ...prev,
        busy: true,
        error: null,
        messages: [...prev.messages, optimistic],
      }))
      try {
        const turn = await predictClient.postChatTurn(reportId, {
          mode,
          message: text,
          chatId: chatIdRefByKey.current[sendKey] ?? null,
          personaId: sendPersonaId,
        })
        // F-H2: write the ref synchronously so the *next* send() — even if
        // it fires before React commits — picks up the new chat_id.
        chatIdRefByKey.current[sendKey] = turn.chat_id
        updateThread(sendKey, (prev) => ({
          ...prev,
          chatId: turn.chat_id,
          busy: false,
          error: null,
          messages: [
            ...prev.messages.filter((m) => m.id !== userId),
            {
              id: turn.user_message_id,
              role: 'user',
              content: text,
              created_at: new Date().toISOString(),
            },
            {
              id: turn.assistant_message_id,
              role: 'assistant',
              content: turn.answer,
              created_at: new Date().toISOString(),
            },
          ],
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        updateThread(sendKey, (prev) => ({
          ...prev,
          busy: false,
          error: message,
          messages: prev.messages.filter((m) => m.id !== userId),
        }))
      }
    },
    [isReady, key, mode, personaId, reportId, updateThread],
  )

  const reset = useCallback(() => {
    chatIdRefByKey.current[key] = null
    rehydratedKeysRef.current.delete(key)
    updateThread(key, () => ({ ...EMPTY }))
  }, [key, updateThread])

  return {
    chatId: current.chatId,
    messages: current.messages,
    busy: current.busy,
    error: current.error,
    send,
    reset,
  }
}
