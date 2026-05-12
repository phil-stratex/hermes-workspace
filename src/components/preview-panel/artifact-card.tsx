import { HugeiconsIcon } from '@hugeicons/react'
import {
  File02Icon,
  FileEditIcon,
  GitCompareIcon,
  TaskAdd01Icon,
} from '@hugeicons/core-free-icons'
import { getBasename, getKindAccent, getKindLabel, isHtmlPath } from './_helpers'
import { usePreviewPanelStore } from '@/stores/preview-panel-store'
import { cn } from '@/lib/utils'

type ArtifactKind = 'file_write' | 'file_edit' | 'file_create' | 'patch'

export type ArtifactCardProps = {
  artifactId: string
  sessionId: string
  path: string
  version: number
  toolName?: string
  kind?: ArtifactKind
  className?: string
}

function iconForKind(kind?: ArtifactKind) {
  switch (kind) {
    case 'file_edit':
      return FileEditIcon
    case 'file_create':
      return TaskAdd01Icon
    case 'patch':
      return GitCompareIcon
    case 'file_write':
    default:
      return File02Icon
  }
}

export function ArtifactCard({
  artifactId,
  sessionId,
  path,
  version,
  toolName,
  kind,
  className,
}: ArtifactCardProps) {
  const accent = getKindAccent(kind)
  const basename = getBasename(path) || path
  const icon = iconForKind(kind)
  const kindLabel = getKindLabel(kind)

  function handleOpen() {
    // Stratex: HTML artifacts default to 'preview' view (rendered iframe)
    // instead of 'code' so users see the visual output immediately.
    usePreviewPanelStore.getState().openArtifact({
      artifactId,
      sessionId,
      path,
      version,
      toolName,
      viewMode: isHtmlPath(path) ? 'preview' : undefined,
    })
  }

  return (
    <button
      type="button"
      onClick={handleOpen}
      title={`Open ${path} (v${version}) in preview panel`}
      className={cn(
        'group inline-flex max-w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left',
        'transition-colors hover:bg-primary-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-950 focus-visible:ring-offset-1',
        accent.border,
        accent.bg,
        className,
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border',
          accent.border,
          accent.text,
        )}
        aria-hidden="true"
      >
        <HugeiconsIcon icon={icon} size={16} strokeWidth={1.5} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'truncate font-mono text-sm font-medium',
              'text-primary-950',
            )}
          >
            {basename}
          </span>
          <span
            className={cn(
              'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
              accent.border,
              accent.text,
            )}
          >
            v{version}
          </span>
          <span
            className={cn(
              'shrink-0 text-[10px] font-medium uppercase tracking-wide',
              accent.text,
            )}
          >
            {kindLabel}
          </span>
        </span>
        <span className="truncate text-xs text-primary-600">{path}</span>
        {toolName ? (
          <span className="truncate text-[11px] text-primary-500">
            via {toolName}
          </span>
        ) : null}
      </span>
    </button>
  )
}
