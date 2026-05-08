import { HugeiconsIcon } from '@hugeicons/react'
import { UserCircleIcon, Tag01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

const STYLE_COLORS: Record<string, string> = {
  formal: 'bg-blue-500/15 text-blue-200',
  terse: 'bg-amber-500/15 text-amber-200',
  verbose: 'bg-purple-500/15 text-purple-200',
  sarcastic: 'bg-rose-500/15 text-rose-200',
  activist: 'bg-emerald-500/15 text-emerald-200',
  'data-heavy': 'bg-cyan-500/15 text-cyan-200',
}

export type PersonaCardData = {
  id: string
  name: string
  role: string
  background: string
  bio: string
  style: string
  seedName?: string | null
  seedType?: string | null
}

function styleClass(style: string): string {
  const lowered = style.toLowerCase()
  for (const [key, cls] of Object.entries(STYLE_COLORS)) {
    if (lowered.includes(key)) return cls
  }
  return 'bg-[var(--theme-bg)] text-[var(--theme-muted)]'
}

function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  const hue = hash % 360
  return `hsl(${hue} 60% 40%)`
}

export function PersonaCard({ persona }: { persona: PersonaCardData }) {
  const initial = (persona.name || '?').trim().charAt(0).toUpperCase()
  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
      <header className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
          style={{ backgroundColor: avatarColor(persona.name) }}
          aria-hidden="true"
        >
          {initial || <HugeiconsIcon icon={UserCircleIcon} size={18} />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-sm font-semibold" title={persona.name}>
              {persona.name}
            </h4>
          </div>
          {persona.role ? (
            <div className="text-xs text-[var(--theme-muted)]">{persona.role}</div>
          ) : null}
        </div>
      </header>

      {persona.background ? (
        <p className="line-clamp-2 text-xs text-[var(--theme-muted)]" title={persona.background}>
          {persona.background}
        </p>
      ) : null}

      {persona.bio ? (
        <p className="line-clamp-3 text-xs italic text-[var(--theme-text)] opacity-90" title={persona.bio}>
          {persona.bio}
        </p>
      ) : null}

      <footer className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        {persona.style ? (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium',
              styleClass(persona.style),
            )}
          >
            {persona.style}
          </span>
        ) : null}
        {persona.seedType ? (
          <span className="flex items-center gap-1 rounded-full border border-[var(--theme-border)] px-2 py-0.5 text-[10px] text-[var(--theme-muted)]">
            <HugeiconsIcon icon={Tag01Icon} size={9} />
            {persona.seedType}
          </span>
        ) : null}
        {persona.seedName && persona.seedName !== persona.name ? (
          <span
            className="truncate rounded-full border border-[var(--theme-border)] px-2 py-0.5 text-[10px] text-[var(--theme-muted)]"
            title={`Seed: ${persona.seedName}`}
          >
            ← {persona.seedName}
          </span>
        ) : null}
      </footer>
    </article>
  )
}
