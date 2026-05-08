import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type ExportResult = {
  ok: boolean
  markdown: string
  count: number
  missing: ReadonlyArray<string>
}

export function BuilderBriefModal({
  open,
  onOpenChange,
  errorIds,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  errorIds: ReadonlyArray<string>
}) {
  const [includeRelated, setIncludeRelated] = useState(true)
  const [copied, setCopied] = useState(false)

  const exportM = useMutation({
    mutationFn: async (): Promise<ExportResult> => {
      const res = await fetch('/api/errors/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          errorIds: [...errorIds],
          includeRelatedLogs: includeRelated,
        }),
      })
      if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`)
      return (await res.json()) as ExportResult
    },
  })

  // Auto-fire when opening
  const fireIfNeeded = () => {
    if (open && !exportM.isPending && !exportM.data && !exportM.isError && errorIds.length > 0) {
      exportM.mutate()
    }
  }
  fireIfNeeded()

  const handleCopy = async () => {
    if (!exportM.data) return
    await navigator.clipboard.writeText(exportM.data.markdown)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDownload = () => {
    if (!exportM.data) return
    const blob = new Blob([exportM.data.markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    a.download = `error-briefing-${stamp}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          exportM.reset()
          setCopied(false)
        }
      }}
    >
      <DialogContent className="!w-[min(720px,94vw)]">
        <div className="flex flex-col gap-3 p-5">
          <DialogTitle>Builder-Brief Export</DialogTitle>
          <DialogDescription>
            {errorIds.length === 1
              ? '1 Fehler-Eintrag als Markdown-Block — direkt in einen Builder-Chat einfügbar.'
              : `${errorIds.length} Einträge als zusammengesetzter Briefing-Block.`}
          </DialogDescription>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={includeRelated}
              onChange={(e) => {
                setIncludeRelated(e.target.checked)
                exportM.reset()
              }}
            />
            Related Logs (±5 s, gleicher requestId) mit aufnehmen
          </label>
          {exportM.isPending && <div className="text-xs opacity-60">Generiere…</div>}
          {exportM.isError && (
            <div className="text-xs" style={{ color: '#ef4444' }}>
              Fehler beim Export. Erneut versuchen.
              <Button variant="outline" className="ml-2" onClick={() => exportM.mutate()}>
                Retry
              </Button>
            </div>
          )}
          {exportM.data && (
            <>
              {exportM.data.missing.length > 0 && (
                <div className="text-xs" style={{ color: '#f59e0b' }}>
                  ⚠️ {exportM.data.missing.length} ID(s) nicht gefunden
                </div>
              )}
              <pre
                className="max-h-[44vh] overflow-auto rounded p-3 text-xs"
                style={{
                  background: 'var(--theme-code-bg, rgba(0,0,0,0.25))',
                  border: '1px solid var(--theme-border)',
                }}
              >
                {exportM.data.markdown}
              </pre>
              <div className="flex items-center gap-2">
                <Button onClick={handleCopy}>
                  {copied ? '✓ Kopiert' : '📋 In Zwischenablage'}
                </Button>
                <Button variant="outline" onClick={handleDownload}>
                  💾 Als .md herunterladen
                </Button>
                <DialogClose>Schliessen</DialogClose>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
