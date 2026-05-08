import { HugeiconsIcon } from '@hugeicons/react'
import { Search01Icon } from '@hugeicons/core-free-icons'

export type FilterState = {
  level: ReadonlyArray<string>
  source: ReadonlyArray<string>
  search: string
  includeTest: boolean
}

const LEVEL_OPTIONS = ['fatal', 'error', 'warn', 'info']
const SOURCE_OPTIONS = [
  'backend',
  'frontend',
  'gateway',
  'swarm',
  'federation',
  'auth',
  'storage',
  'migration',
]

export function FilterBar({
  state,
  onChange,
}: {
  state: FilterState
  onChange: (next: FilterState) => void
}) {
  const toggle = (key: 'level' | 'source', value: string) => {
    const set = new Set(state[key])
    if (set.has(value)) set.delete(value)
    else set.add(value)
    onChange({ ...state, [key]: [...set] })
  }
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg p-3"
      style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)' }}
    >
      <div className="flex items-center gap-1">
        <span className="text-xs uppercase opacity-60">Level:</span>
        {LEVEL_OPTIONS.map((lv) => {
          const on = state.level.includes(lv)
          return (
            <button
              key={lv}
              type="button"
              onClick={() => toggle('level', lv)}
              className="rounded px-2 py-0.5 text-xs"
              style={{
                background: on ? 'var(--theme-accent, rgba(91,108,255,0.25))' : 'transparent',
                border: '1px solid var(--theme-border)',
                color: on ? 'var(--theme-text)' : 'var(--theme-muted)',
              }}
            >
              {lv}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-xs uppercase opacity-60">Source:</span>
        {SOURCE_OPTIONS.map((s) => {
          const on = state.source.includes(s)
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle('source', s)}
              className="rounded px-2 py-0.5 text-xs"
              style={{
                background: on ? 'var(--theme-accent, rgba(91,108,255,0.25))' : 'transparent',
                border: '1px solid var(--theme-border)',
                color: on ? 'var(--theme-text)' : 'var(--theme-muted)',
              }}
            >
              {s}
            </button>
          )
        })}
      </div>
      <label
        className="ml-auto flex cursor-pointer items-center gap-1 text-xs"
        style={{ color: 'var(--theme-muted)' }}
      >
        <input
          type="checkbox"
          checked={state.includeTest}
          onChange={(e) => onChange({ ...state, includeTest: e.target.checked })}
        />
        Test-Errors zeigen
      </label>
      <div
        className="flex items-center gap-1 rounded px-2"
        style={{ background: 'var(--theme-input-bg, rgba(255,255,255,0.04))' }}
      >
        <HugeiconsIcon icon={Search01Icon} size={14} />
        <input
          type="search"
          value={state.search}
          onChange={(e) => onChange({ ...state, search: e.target.value })}
          placeholder="Suche message / route…"
          className="bg-transparent py-1 text-xs outline-none"
          style={{ color: 'var(--theme-text)', minWidth: 220 }}
        />
      </div>
    </div>
  )
}
