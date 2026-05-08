import type { ActionTickerEntry } from '../hooks/use-run-progress'
import { cn } from '@/lib/utils'

const ACTION_GLYPH: Record<string, string> = {
  post: '✏️',
  reply: '💬',
  comment: '💬',
  like: '❤',
  upvote: '▲',
  downvote: '▼',
  dislike: '↓',
  repost: '↻',
  idle: '·',
}

export function ActionTicker({ entries }: { entries: Array<ActionTickerEntry> }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--theme-border)] bg-[var(--theme-card)] p-4 text-center text-[10px] text-[var(--theme-muted)]">
        Live-Aktionen erscheinen hier sobald die Simulation läuft.
      </div>
    )
  }
  return (
    <ul className="space-y-1.5 text-[11px]">
      {entries.map((entry) => {
        const glyph = ACTION_GLYPH[entry.action] ?? '·'
        return (
          <li
            key={entry.id}
            className={cn(
              'flex items-baseline gap-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-2 py-1.5',
              entry.action === 'idle' && 'opacity-60',
            )}
          >
            <span className="w-4 text-center text-sm leading-none">{glyph}</span>
            <span className="w-12 shrink-0 text-[var(--theme-muted)]">R{entry.roundNo}</span>
            <span className="w-20 shrink-0 truncate font-semibold" title={entry.personaName}>
              {entry.personaName}
            </span>
            <span className="w-12 shrink-0 text-[10px] uppercase text-[var(--theme-muted)]">
              {entry.platform}
            </span>
            <span className="min-w-0 flex-1 truncate" title={entry.content ?? entry.action}>
              {entry.content ?? entry.action}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
