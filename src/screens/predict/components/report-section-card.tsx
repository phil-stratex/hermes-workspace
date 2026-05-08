import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkCircle02Icon,
  AlertCircleIcon,
  Clock01Icon,
  Copy01Icon,
} from '@hugeicons/core-free-icons'
import type { ReportSectionState } from '../hooks/use-report-progress'
import { Markdown } from '@/components/prompt-kit/markdown'
import { cn } from '@/lib/utils'

const STATUS_CHIP: Record<string, string> = {
  pending: 'bg-[var(--theme-bg)] text-[var(--theme-muted)]',
  running: 'bg-yellow-500/15 text-yellow-200',
  completed: 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent)]',
  failed: 'bg-red-500/20 text-red-300',
}

export function ReportSectionCard({ section }: { section: ReportSectionState }) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(true)

  const onCopy = () => {
    if (!section.content) return
    void navigator.clipboard.writeText(section.content).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <article className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase text-[var(--theme-muted)]">
            <span>Sektion {section.ordering + 1}</span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 font-semibold',
                STATUS_CHIP[section.status] ?? STATUS_CHIP.pending,
              )}
            >
              {section.status}
            </span>
          </div>
          <h3 className="mt-1 flex items-center gap-2 text-base font-semibold">
            {section.status === 'completed' ? (
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} />
            ) : section.status === 'failed' ? (
              <HugeiconsIcon icon={AlertCircleIcon} size={14} />
            ) : section.status === 'running' ? (
              <HugeiconsIcon icon={Clock01Icon} size={14} />
            ) : null}
            {section.title}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {section.content ? (
            <button
              type="button"
              onClick={onCopy}
              title="Sektion kopieren"
              className="flex items-center gap-1 rounded-full border border-[var(--theme-border)] px-2 py-1 text-[10px] text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
            >
              <HugeiconsIcon icon={Copy01Icon} size={9} />
              {copied ? 'Kopiert' : 'Copy'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-full border border-[var(--theme-border)] px-2 py-1 text-[10px] text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
            aria-expanded={open}
          >
            {open ? 'Einklappen' : 'Ausklappen'}
          </button>
        </div>
      </header>

      {open ? (
        <div className="mt-3">
          {section.content ? (
            <div className="prose prose-sm max-w-none text-[var(--theme-text)]">
              <Markdown>{section.content}</Markdown>
            </div>
          ) : section.status === 'failed' ? (
            <p className="text-xs text-red-300">
              Sektion-Generation fehlgeschlagen: {section.error || '(unbekannter Fehler)'}
            </p>
          ) : section.status === 'running' ? (
            <SectionSkeleton />
          ) : (
            <p className="text-xs text-[var(--theme-muted)]">Sektion ist eingereiht und wird gleich gestartet.</p>
          )}
        </div>
      ) : null}
    </article>
  )
}

function SectionSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded bg-[var(--theme-bg)]"
          style={{ width: `${100 - i * 12}%` }}
        />
      ))}
    </div>
  )
}
