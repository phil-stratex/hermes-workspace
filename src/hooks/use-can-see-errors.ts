/**
 * Sidebar-visibility probe for the global error-log.
 *
 * Hits `GET /api/errors/health` — server enforces the same `requireStackAdmin`
 * gate as the rest of the `/api/errors/*` surface, so a 200 here means
 * "this user can see the error-log; render the sidebar entry". 401/403
 * hides it without leaking the gate decision.
 *
 * Stale-time 60 s matches the bell-counter polling cadence so the two
 * queries deduplicate on the same key. retry:false avoids burning
 * requests when the user is permanently a non-admin.
 */

import { useQuery } from '@tanstack/react-query'

export type ErrorsVisibility = {
  canSee: boolean
  status: number
}

export function useCanSeeErrors(): ErrorsVisibility {
  const query = useQuery({
    queryKey: ['errors-visibility'],
    queryFn: async (): Promise<ErrorsVisibility> => {
      const res = await fetch('/api/errors/health')
      return { canSee: res.ok, status: res.status }
    },
    staleTime: 60_000,
    retry: false,
  })
  return query.data ?? { canSee: false, status: 0 }
}
