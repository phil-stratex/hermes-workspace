import { describe, expect, it } from 'vitest'

import {
  _hasActiveContextForTests,
  getContext,
  runWithContext,
} from './request-context'

describe('request-context', () => {
  it('exposes the active context inside runWithContext', async () => {
    let inner: unknown = null
    await runWithContext(
      {
        requestId: 'r1',
        userId: 'phil',
        workspaceId: 'ws1',
        route: '/x',
        method: 'GET',
        ip: null,
      },
      async () => {
        inner = getContext()
      },
    )
    expect(inner).toMatchObject({ requestId: 'r1', userId: 'phil', workspaceId: 'ws1' })
  })

  it('returns null outside of any run-block', () => {
    expect(getContext()).toBeNull()
    expect(_hasActiveContextForTests()).toBe(false)
  })

  it('propagates the context across awaits', async () => {
    const seen: Array<string> = []
    await runWithContext(
      {
        requestId: 'r2',
        userId: null,
        workspaceId: null,
        route: null,
        method: null,
        ip: null,
      },
      async () => {
        seen.push(getContext()?.requestId ?? '!')
        await new Promise((r) => setTimeout(r, 5))
        seen.push(getContext()?.requestId ?? '!')
      },
    )
    expect(seen).toEqual(['r2', 'r2'])
  })

  it('isolates 100 parallel requests — each sees only its own ctx', async () => {
    const N = 100
    const tasks: Array<Promise<string>> = []
    for (let i = 0; i < N; i++) {
      tasks.push(
        runWithContext(
          {
            requestId: `r${i}`,
            userId: null,
            workspaceId: null,
            route: null,
            method: null,
            ip: null,
          },
          async () => {
            // small jitter so the runs interleave
            await new Promise((r) => setTimeout(r, Math.random() * 10))
            return getContext()?.requestId ?? '!'
          },
        ) as Promise<string>,
      )
    }
    const results = await Promise.all(tasks)
    expect(new Set(results).size).toBe(N)
    for (let i = 0; i < N; i++) {
      expect(results[i]).toBe(`r${i}`)
    }
  })

  it('nested runWithContext shadows the outer ctx within the inner block', async () => {
    const seen: Array<string> = []
    await runWithContext(
      {
        requestId: 'outer',
        userId: null,
        workspaceId: null,
        route: null,
        method: null,
        ip: null,
      },
      async () => {
        seen.push(getContext()?.requestId ?? '!')
        await runWithContext(
          {
            requestId: 'inner',
            userId: null,
            workspaceId: null,
            route: null,
            method: null,
            ip: null,
          },
          async () => {
            seen.push(getContext()?.requestId ?? '!')
          },
        )
        seen.push(getContext()?.requestId ?? '!')
      },
    )
    expect(seen).toEqual(['outer', 'inner', 'outer'])
  })
})
