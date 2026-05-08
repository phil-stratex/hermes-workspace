import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, RocketIcon, Settings02Icon } from '@hugeicons/core-free-icons'
import type { SimulationConfig } from '@/server/predict-client'
import { cn } from '@/lib/utils'

const PLATFORM_OPTIONS = [
  { id: 'plaza', label: 'Info-Plaza', subtitle: 'Twitter-Stil — Posts, Likes, Reposts' },
  { id: 'community', label: 'Topic-Community', subtitle: 'Reddit-Stil — Threads, Up/Down, Trends' },
] as const

const DEFAULT_CONFIG: SimulationConfig = {
  num_agents: 12,
  max_rounds: 5,
  platforms: ['plaza', 'community'],
  domain: 'general',
  notes: '',
}

export function EnvSetupPanel({
  initial,
  busy,
  onStart,
  startLabel = 'Personas erzeugen',
}: {
  initial?: SimulationConfig
  busy?: boolean
  onStart: (config: SimulationConfig) => void
  startLabel?: string
}) {
  const [config, setConfig] = useState<SimulationConfig>(initial ?? DEFAULT_CONFIG)

  useEffect(() => {
    if (initial) setConfig(initial)
  }, [initial])

  const togglePlatform = (id: string) => {
    setConfig((prev) => {
      const present = prev.platforms.includes(id)
      const next = present ? prev.platforms.filter((p) => p !== id) : [...prev.platforms, id]
      return { ...prev, platforms: next.length === 0 ? [id] : next }
    })
  }

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5">
      <div className="flex items-center gap-2">
        <HugeiconsIcon icon={Settings02Icon} size={16} />
        <h3 className="text-sm font-semibold">Simulation einrichten</h3>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Slider
          label="Anzahl Agents"
          min={2}
          max={50}
          step={1}
          value={config.num_agents}
          onChange={(v) => setConfig((c) => ({ ...c, num_agents: v }))}
          hint={config.num_agents <= 8 ? 'Schnell, schwach' : config.num_agents >= 30 ? 'Detailreich, langsam' : 'Ausgewogen'}
        />
        <Slider
          label="Max Runden"
          min={1}
          max={20}
          step={1}
          value={config.max_rounds}
          onChange={(v) => setConfig((c) => ({ ...c, max_rounds: v }))}
          hint={config.max_rounds < 3 ? 'Sehr kurz' : config.max_rounds > 10 ? 'Sehr tief' : 'Standard'}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold text-[var(--theme-muted)]">Plattformen</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {PLATFORM_OPTIONS.map((opt) => {
            const active = config.platforms.includes(opt.id)
            return (
              <button
                key={opt.id}
                type="button"
                aria-pressed={active}
                disabled={busy}
                onClick={() => togglePlatform(opt.id)}
                className={cn(
                  'rounded-xl border p-3 text-left text-xs transition',
                  active
                    ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)]'
                    : 'border-[var(--theme-border)] bg-[var(--theme-bg)] hover:border-[var(--theme-accent)]',
                  busy && 'cursor-not-allowed opacity-50',
                )}
              >
                <div className="font-semibold">{opt.label}</div>
                <div className="mt-0.5 text-[var(--theme-muted)]">{opt.subtitle}</div>
              </button>
            )
          })}
        </div>
      </fieldset>

      <label className="block text-xs">
        <span className="font-semibold text-[var(--theme-muted)]">Domain (optional)</span>
        <input
          type="text"
          value={config.domain}
          onChange={(e) => setConfig((c) => ({ ...c, domain: e.target.value }))}
          disabled={busy}
          placeholder="z.B. climate-policy, fintech-regulation, festival-marketing"
          className="mt-1 w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm placeholder:text-[var(--theme-muted)] focus:border-[var(--theme-accent)] focus:outline-none disabled:opacity-60"
        />
      </label>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={() => onStart(config)}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--theme-accent)] px-4 py-2 text-sm font-semibold text-primary-950 hover:bg-[var(--theme-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <HugeiconsIcon icon={RocketIcon} size={14} />
          {busy ? 'Starte…' : startLabel}
          <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
        </button>
      </div>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  hint?: string
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold text-[var(--theme-muted)]">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className="flex-1 accent-[var(--theme-accent)]"
        />
        <span className="w-8 shrink-0 text-right text-sm font-semibold">{value}</span>
      </div>
      {hint ? <span className="text-[10px] text-[var(--theme-muted)]">{hint}</span> : null}
    </label>
  )
}
