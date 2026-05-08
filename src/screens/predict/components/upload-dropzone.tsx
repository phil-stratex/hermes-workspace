import { useCallback, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { CloudUploadIcon, File01Icon, Delete02Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

const ACCEPTED = ['application/pdf', 'text/plain', 'text/markdown', 'text/x-markdown']
const ACCEPTED_EXTENSIONS = ['.pdf', '.md', '.markdown', '.txt']
const MAX_FILES = 8
const MAX_TOTAL_BYTES = 50 * 1024 * 1024

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function isAcceptable(file: File): boolean {
  if (ACCEPTED.includes(file.type)) return true
  const lower = file.name.toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function UploadDropzone({
  files,
  onChange,
  disabled,
}: {
  files: Array<File>
  onChange: (next: Array<File>) => void
  disabled?: boolean
}) {
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)

  const accept = useCallback(
    (incoming: FileList | Array<File>) => {
      const arr = Array.from(incoming)
      const acceptable: Array<File> = []
      const rejected: Array<string> = []
      for (const file of arr) {
        if (!isAcceptable(file)) {
          rejected.push(`${file.name} (Typ nicht unterstützt)`)
          continue
        }
        acceptable.push(file)
      }
      const merged = [...files]
      for (const f of acceptable) {
        if (merged.some((m) => m.name === f.name && m.size === f.size)) continue
        merged.push(f)
      }
      if (merged.length > MAX_FILES) {
        setError(`Maximal ${MAX_FILES} Dateien.`)
        return
      }
      const total = merged.reduce((sum, f) => sum + f.size, 0)
      if (total > MAX_TOTAL_BYTES) {
        setError(`Gesamtgröße über ${bytes(MAX_TOTAL_BYTES)}.`)
        return
      }
      if (rejected.length > 0) {
        setError(`Übersprungen: ${rejected.join(', ')}`)
      } else {
        setError(null)
      }
      onChange(merged)
    },
    [files, onChange],
  )

  return (
    <div
      onDragOver={(e) => {
        if (disabled) return
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        if (disabled) return
        e.preventDefault()
        setIsDragging(false)
        accept(e.dataTransfer.files)
      }}
      className={cn(
        'rounded-2xl border-2 border-dashed p-6 transition',
        isDragging
          ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)]'
          : 'border-[var(--theme-border)] bg-[var(--theme-card)]',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="flex w-full flex-col items-center gap-2 py-2 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--theme-accent-soft)]">
          <HugeiconsIcon icon={CloudUploadIcon} size={22} />
        </div>
        <div className="text-sm font-semibold">PDF, Markdown oder Text hier ablegen</div>
        <div className="text-xs text-[var(--theme-muted)]">
          oder klicken zum Auswählen · max. {MAX_FILES} Dateien · bis {bytes(MAX_TOTAL_BYTES)} gesamt
        </div>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS.join(',')}
        className="sr-only"
        onChange={(e) => {
          if (e.target.files) accept(e.target.files)
          e.target.value = ''
        }}
        disabled={disabled}
      />

      {files.length > 0 ? (
        <ul className="mt-4 space-y-1.5">
          {files.map((file) => (
            <li
              key={`${file.name}-${file.size}`}
              className="flex items-center gap-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-xs"
            >
              <HugeiconsIcon icon={File01Icon} size={14} />
              <span className="flex-1 truncate" title={file.name}>
                {file.name}
              </span>
              <span className="text-[var(--theme-muted)]">{bytes(file.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                onClick={() =>
                  onChange(files.filter((f) => !(f.name === file.name && f.size === file.size)))
                }
                className="text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
              >
                <HugeiconsIcon icon={Delete02Icon} size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {totalBytes > 0 ? (
        <div className="mt-2 text-right text-[10px] text-[var(--theme-muted)]">
          Gesamt: {bytes(totalBytes)} / {bytes(MAX_TOTAL_BYTES)}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-lg border border-yellow-500 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
          {error}
        </div>
      ) : null}
    </div>
  )
}
