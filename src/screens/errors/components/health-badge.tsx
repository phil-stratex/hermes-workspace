import { useQuery } from '@tanstack/react-query'

import { cn } from '@/lib/utils'

type HealthData = {
  ok: boolean
  windowMs: number
  total: number
  counts: Record<string, number>
  health: 'green' | 'yellow' | 'red'
}

const COLOR: Record<HealthData['health'], { bg: string; text: string; label: string }> = {
  green: { bg: '#16a34a22', text: '#22c55e', label: '🟢 OK' },
  yellow: { bg: '#eab30822', text: '#f59e0b', label: '🟡 Erhöht' },
  red: { bg: '#dc262622', text: '#ef4444', label: '🔴 Kritisch' },
}

export function HealthBadge() {
  const q = useQuery({
    queryKey: ['errors-health', 60 * 60 * 1000],
    queryFn: async () => {
      const res = await fetch('/api/errors/health?windowMs=3600000')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as HealthData
    },
    staleTime: 30_000,
  })
  if (!q.data) {
    return (
      <span
        className="inline-flex items-center rounded-md px-2 py-1 text-xs"
        style={{
          background: 'var(--theme-muted-bg, rgba(255,255,255,0.05))',
          color: 'var(--theme-muted)',
        }}
      >
        …
      </span>
    )
  }
  const { health, counts } = q.data
  const c = COLOR[health]
  const fatal = counts.fatal ?? 0
  const error = counts.error ?? 0
  const warn = counts.warn ?? 0
  return (
    <span
      className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium"
      style={{ background: c.bg, color: c.text }}
    >
      <span>{c.label}</span>
      <span style={{ opacity: 0.85 }}>
        {fatal > 0 && (
          <span className={cn('mr-1.5')}>{fatal}× fatal</span>
        )}
        {error}× error · {warn}× warn (1h)
      </span>
    </span>
  )
}
