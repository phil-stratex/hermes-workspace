import { cn } from '@/lib/utils'

export type ActivityStatus = 'idle' | 'running' | 'blocked' | 'offline'

const STATUS_STYLES: Record<ActivityStatus, { color: string; pulse: boolean; label: string }> = {
  idle: {
    color: 'bg-[var(--theme-muted)]/40',
    pulse: false,
    label: 'idle',
  },
  running: {
    color: 'bg-yellow-400',
    pulse: true,
    label: 'running',
  },
  blocked: {
    color: 'bg-red-500',
    pulse: false,
    label: 'blocked',
  },
  offline: {
    color: 'bg-[var(--theme-muted)]/20',
    pulse: false,
    label: 'offline',
  },
}

export function ActivityDot({
  status,
  size = 8,
  className,
  title,
}: {
  status: ActivityStatus
  size?: number
  className?: string
  title?: string
}) {
  const cfg = STATUS_STYLES[status]
  return (
    <span
      className={cn('relative inline-flex shrink-0', className)}
      title={title ?? cfg.label}
    >
      {cfg.pulse ? (
        <span
          className={cn(
            'absolute inline-flex animate-ping rounded-full opacity-75',
            cfg.color,
          )}
          style={{ width: size, height: size }}
        />
      ) : null}
      <span
        className={cn('relative inline-flex rounded-full', cfg.color)}
        style={{ width: size, height: size }}
      />
    </span>
  )
}
