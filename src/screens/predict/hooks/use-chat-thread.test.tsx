// @vitest-environment jsdom
/**
 * Tests for useChatThread.
 *
 * Mounts the hook through a tiny harness component into a real DOM root via
 * createRoot + React.act (same pattern as
 * src/screens/mcp/-marketplace-install-confirmation.test.tsx) so we can
 * exercise hook state without hitting the @testing-library/react renderHook
 * dual-React-instance issue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'

// ---------------------------------------------------------------------------
// Mocks (must be hoisted before importing the hook).
// ---------------------------------------------------------------------------

const postChatTurn = vi.fn()
const getChatHistory = vi.fn()

vi.mock('@/server/predict-client', () => ({
  predictClient: {
    postChatTurn: (...args: Array<unknown>) => postChatTurn(...args),
    getChatHistory: (...args: Array<unknown>) => getChatHistory(...args),
  },
}))

// Replace TanStack's QueryClientProvider/useQueryClient with a tiny stub.
// Real react-query gets pre-bundled by vite into a separate react-dom copy,
// triggering "two copies of React" → null hooks. We only need fetchQuery
// for the rehydrate-effect; everything else can be a no-op.
vi.mock('@tanstack/react-query', () => {
  const fetchQuery = vi.fn(() => Promise.resolve(undefined))
  return {
    QueryClient: class {
      fetchQuery = fetchQuery
    },
    QueryClientProvider: ({ children }: { children: unknown }) =>
      children as unknown as React.ReactElement,
    useQueryClient: () => ({ fetchQuery }),
    __mocked_fetchQuery: fetchQuery,
  }
})

import { useChatThread, type ChatThreadHandle } from './use-chat-thread'

// ---------------------------------------------------------------------------
// Harness — exposes the hook handle via a ref.
// ---------------------------------------------------------------------------

type HarnessProps = {
  reportId: string
  mode: 'agent' | 'persona'
  personaId?: string | null
  handleRef: { current: ChatThreadHandle | null }
}

function Harness({ reportId, mode, personaId, handleRef }: HarnessProps) {
  const handle = useChatThread(reportId, mode, personaId)
  handleRef.current = handle
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

// Run any queued microtasks/promises before assertions.
const flush = () => React.act(async () => {})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useChatThread — initial state', () => {
  it('returns empty messages, null chatId, and not busy on first render', async () => {
    const ref: { current: ChatThreadHandle | null } = { current: null }
    const { unmount } = await mountHook({
      reportId: 'r1',
      mode: 'agent',
      handleRef: ref,
    })
    expect(ref.current).not.toBeNull()
    expect(ref.current!.messages).toEqual([])
    expect(ref.current!.chatId).toBeNull()
    expect(ref.current!.busy).toBe(false)
    expect(ref.current!.error).toBeNull()
    await unmount()
  })
})

describe('useChatThread — send()', () => {
  it('adds optimistic user message and flips busy=true while in-flight', async () => {
    let resolveTurn!: (v: unknown) => void
    postChatTurn.mockImplementation(
      () => new Promise((resolve) => (resolveTurn = resolve)),
    )

    const ref: { current: ChatThreadHandle | null } = { current: null }
    const { unmount } = await mountHook({
      reportId: 'r1',
      mode: 'agent',
      handleRef: ref,
    })

    let sendPromise: Promise<void>
    await React.act(async () => {
      sendPromise = ref.current!.send('hello')
    })
    // Optimistic state should now be visible.
    expect(ref.current!.busy).toBe(true)
    expect(ref.current!.messages).toHaveLength(1)
    expect(ref.current!.messages[0].role).toBe('user')
    expect(ref.current!.messages[0].content).toBe('hello')
    expect(ref.current!.messages[0].id.startsWith('temp-user-')).toBe(true)

    // Resolve the API and let React commit.
    await React.act(async () => {
      resolveTurn({
        chat_id: 'chat-1',
        user_message_id: 'real-u',
        assistant_message_id: 'real-a',
        answer: 'hi back',
      })
      await sendPromise
    })

    expect(ref.current!.busy).toBe(false)
    expect(ref.current!.chatId).toBe('chat-1')
    expect(ref.current!.messages).toHaveLength(2)
    expect(ref.current!.messages[0]).toMatchObject({
      id: 'real-u',
      role: 'user',
      content: 'hello',
    })
    expect(ref.current!.messages[1]).toMatchObject({
      id: 'real-a',
      role: 'assistant',
      content: 'hi back',
    })
    // Optimistic temp-id should have been replaced.
    expect(ref.current!.messages.some((m) => m.id.startsWith('temp-user-'))).toBe(false)

    await unmount()
  })

  it('two parallel sends share the same chat_id (chatIdRef sync write)', async () => {
    // First send establishes chat_id; second send (fired while first is still
    // pending only on resolve) reads chatIdRef synchronously after the first
    // has resolved, so it must include chatId='chat-1' in its postChatTurn body.
    let resolveFirst!: (v: unknown) => void
    let resolveSecond!: (v: unknown) => void
    postChatTurn
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveSecond = resolve)),
      )

    const ref: { current: ChatThreadHandle | null } = { current: null }
    const { unmount } = await mountHook({
      reportId: 'r1',
      mode: 'agent',
      handleRef: ref,
    })

    let p1: Promise<void>
    await React.act(async () => {
      p1 = ref.current!.send('first')
    })
    // Resolve the first turn — sets chatIdRef synchronously inside send().
    await React.act(async () => {
      resolveFirst({
        chat_id: 'chat-XYZ',
        user_message_id: 'u1',
        assistant_message_id: 'a1',
        answer: 'one',
      })
      await p1
    })
    expect(ref.current!.chatId).toBe('chat-XYZ')

    // Now fire the second send — it should pick up chat-XYZ.
    let p2: Promise<void>
    await React.act(async () => {
      p2 = ref.current!.send('second')
    })
    await React.act(async () => {
      resolveSecond({
        chat_id: 'chat-XYZ',
        user_message_id: 'u2',
        assistant_message_id: 'a2',
        answer: 'two',
      })
      await p2
    })

    expect(postChatTurn).toHaveBeenCalledTimes(2)
    const secondCallBody = postChatTurn.mock.calls[1][1] as { chatId: string | null }
    expect(secondCallBody.chatId).toBe('chat-XYZ')

    await unmount()
  })

  it('rolls back optimistic message and surfaces error on rejection', async () => {
    postChatTurn.mockRejectedValueOnce(new Error('network down'))

    const ref: { current: ChatThreadHandle | null } = { current: null }
    const { unmount } = await mountHook({
      reportId: 'r1',
      mode: 'agent',
      handleRef: ref,
    })

    await React.act(async () => {
      await ref.current!.send('failing')
    })
    await flush()

    expect(ref.current!.busy).toBe(false)
    expect(ref.current!.error).toBe('network down')
    expect(ref.current!.messages).toEqual([])

    await unmount()
  })
})

describe('useChatThread — persona keying', () => {
  it('keeps separate threads per persona_id (no cross-leak)', async () => {
    postChatTurn.mockResolvedValueOnce({
      chat_id: 'chat-A',
      user_message_id: 'uA',
      assistant_message_id: 'aA',
      answer: 'A says hi',
    })

    const ref: { current: ChatThreadHandle | null } = { current: null }
    const { rerender, unmount } = await mountHook({
      reportId: 'r1',
      mode: 'persona',
      personaId: 'persona-A',
      handleRef: ref,
    })

    await React.act(async () => {
      await ref.current!.send('to A')
    })
    await flush()

    expect(ref.current!.messages.length).toBe(2)
    expect(ref.current!.chatId).toBe('chat-A')

    // Switch to persona-B — fresh, empty thread.
    await rerender({
      reportId: 'r1',
      mode: 'persona',
      personaId: 'persona-B',
      handleRef: ref,
    })
    expect(ref.current!.messages).toEqual([])
    expect(ref.current!.chatId).toBeNull()

    // Switch back to persona-A — original thread is intact.
    await rerender({
      reportId: 'r1',
      mode: 'persona',
      personaId: 'persona-A',
      handleRef: ref,
    })
    expect(ref.current!.messages.length).toBe(2)
    expect(ref.current!.chatId).toBe('chat-A')

    await unmount()
  })
})

describe('useChatThread — reset()', () => {
  it('clears messages, chatId, and error for the active key', async () => {
    postChatTurn.mockResolvedValueOnce({
      chat_id: 'chat-1',
      user_message_id: 'u',
      assistant_message_id: 'a',
      answer: 'ack',
    })

    const ref: { current: ChatThreadHandle | null } = { current: null }
    const { unmount } = await mountHook({
      reportId: 'r1',
      mode: 'agent',
      handleRef: ref,
    })
    await React.act(async () => {
      await ref.current!.send('foo')
    })
    await flush()
    expect(ref.current!.messages.length).toBe(2)

    await React.act(async () => {
      ref.current!.reset()
    })
    expect(ref.current!.messages).toEqual([])
    expect(ref.current!.chatId).toBeNull()
    expect(ref.current!.error).toBeNull()

    await unmount()
  })
})
