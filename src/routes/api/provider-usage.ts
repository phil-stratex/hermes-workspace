import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../server/route-auth-helpers'
import { getProviderUsage } from '../../server/provider-usage'
// (auth-middleware import dropped — uses route-auth-helpers below)

const REQUEST_TIMEOUT_MS = 5000 // 5 second timeout

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), ms)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timeoutId!)
  }
}

export type {
  ProviderUsageResult,
  ProviderUsageResponse,
  UsageLine,
} from '../../server/provider-usage'

export const Route = createFileRoute('/api/provider-usage')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response
        try {
          const url = new URL(request.url)
          const force = url.searchParams.get('force') === '1'
          const payload = await withTimeout(
            getProviderUsage(force),
            REQUEST_TIMEOUT_MS,
            'Provider usage request timed out',
          )
          return json(payload)
        } catch (err) {
          return json(
            {
              ok: false,
              updatedAt: Date.now(),
              providers: [],
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 503 },
          )
        }
      },
    },
  },
})
