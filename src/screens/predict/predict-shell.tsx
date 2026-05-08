import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Telescope01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

const STEPS = [
  { n: 1, label: 'Upload & Graph' },
  { n: 2, label: 'Environment' },
  { n: 3, label: 'Simulation' },
  { n: 4, label: 'Report' },
  { n: 5, label: 'Interaction' },
] as const

export type PredictStep = (typeof STEPS)[number]['n']

export function PredictShell({
  step,
  title,
  subtitle,
  children,
  rightSlot,
}: {
  step: PredictStep | null
  title: string
  subtitle?: string
  children: ReactNode
  rightSlot?: ReactNode
}) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 text-[var(--theme-text)]">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-2.5">
            <HugeiconsIcon icon={Telescope01Icon} size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{title}</h1>
            {subtitle ? (
              <p className="text-sm text-[var(--theme-muted)]">{subtitle}</p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">{rightSlot}</div>
      </header>

      {step != null ? <StepIndicator current={step} /> : null}

      {children}
    </div>
  )
}

function StepIndicator({ current }: { current: PredictStep }) {
  return (
    <ol
      className="flex flex-wrap items-center gap-2 text-xs"
      aria-label="Predict workflow"
    >
      {STEPS.map((s, idx) => {
        const isDone = s.n < current
        const isActive = s.n === current
        return (
          <li
            key={s.n}
            className={cn(
              'flex items-center gap-2 rounded-full px-3 py-1.5 border',
              isActive
                ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)]'
                : isDone
                  ? 'border-[var(--theme-border)] bg-[var(--theme-bg)] opacity-90'
                  : 'border-[var(--theme-border)] opacity-60',
            )}
          >
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                isActive
                  ? 'bg-[var(--theme-accent)] text-primary-950'
                  : isDone
                    ? 'bg-[var(--theme-accent-soft)]'
                    : 'border border-[var(--theme-border)]',
              )}
            >
              {s.n}
            </span>
            <span>{s.label}</span>
            {idx < STEPS.length - 1 ? (
              <span className="text-[var(--theme-muted)]">›</span>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

export function PhasePlaceholder({
  phase,
  description,
}: {
  phase: string
  description: string
}) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-[var(--theme-border)] bg-[var(--theme-card)] p-8 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--theme-accent-soft)]">
        <HugeiconsIcon icon={Telescope01Icon} size={22} />
      </div>
      <div className="text-sm font-semibold">{phase}</div>
      <p className="mx-auto mt-2 max-w-md text-xs text-[var(--theme-muted)]">
        {description}
      </p>
    </div>
  )
}
