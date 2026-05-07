import { useEffect, useRef } from 'react'

const TICK_INTERVAL_MS = 60_000

/**
 * Polls /api/swarm-idle-tick every 60s while the Swarm page is open.
 * The endpoint dispatches standing missions to idle workers (cooldown 5
 * minutes per worker is enforced server-side).
 *
 * `enabled` is exposed so the Swarm UI can offer a toggle in settings —
 * default is on whenever the Swarm screen is mounted.
 */
export function useStandingMissionTicker({ enabled = true }: { enabled?: boolean } = {}) {
  const tickingRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    async function tick() {
      if (tickingRef.current) return
      tickingRef.current = true
      try {
        await fetch('/api/swarm-idle-tick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      } catch {
        // best-effort — next tick will retry
      } finally {
        tickingRef.current = false
      }
    }

    // Fire one immediate tick, then schedule.
    void tick()
    const id = window.setInterval(() => {
      if (!cancelled) void tick()
    }, TICK_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [enabled])
}
