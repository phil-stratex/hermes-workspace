import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { RefreshIcon } from '@hugeicons/core-free-icons'
import { fetchArtifactDetail, previewQueryKeys } from './_api'
import { cn } from '@/lib/utils'

type IframeMode = 'srcdoc' | 'live'

type IframeSrcdocProps = {
  artifactId: string
  mode?: 'srcdoc'
}

type IframeLiveProps = {
  mode: 'live'
  runId: string
  /**
   * Optional external reload key. When the parent (RunAppTab toolbar) wants
   * to force a hard reload of the iframe, it bumps this number. We add it to
   * our local counter so the iframe `key` changes either way.
   */
  reloadKey?: number
}

type IframeViewProps = IframeSrcdocProps | IframeLiveProps

const TAILWIND_CDN_TAG =
  '<script src="https://cdn.tailwindcss.com"></script>'

const TAILWIND_HINT_RE =
  /class="[^"]*\b(?:flex|grid|block|inline|hidden|absolute|relative|fixed|sticky|p-[\dxy]|m-[\dxy]|text-(?:xs|sm|base|lg|xl|\dxl)|bg-(?:white|black|red-|blue-|green-|gray-|neutral-|slate-|zinc-|emerald-|amber-|primary-)|font-(?:bold|semibold|medium|light|thin)|rounded(?:-|")|w-\d|h-\d)/

function alreadyHasTailwind(html: string): boolean {
  return /<script[^>]*\b(?:cdn\.tailwindcss\.com|tailwindcss)\b/i.test(html)
}

function looksLikeTailwind(html: string): boolean {
  return TAILWIND_HINT_RE.test(html)
}

function buildSrcDoc(content: string): string {
  const trimmed = content.trim()
  const needsTailwind =
    looksLikeTailwind(trimmed) && !alreadyHasTailwind(trimmed)

  const headCloseIndex = trimmed.search(/<\/head\s*>/i)
  const hasHead = headCloseIndex >= 0
  const hasHtmlTag = /<html\b/i.test(trimmed)

  if (hasHead) {
    if (!needsTailwind) return trimmed
    return (
      trimmed.slice(0, headCloseIndex) +
      TAILWIND_CDN_TAG +
      trimmed.slice(headCloseIndex)
    )
  }

  if (hasHtmlTag) {
    // <html> exists but no <head> — inject a head right after the html tag.
    return trimmed.replace(
      /<html([^>]*)>/i,
      `<html$1><head>${needsTailwind ? TAILWIND_CDN_TAG : ''}</head>`,
    )
  }

  // No html shell at all — wrap.
  return [
    '<!DOCTYPE html>',
    '<html><head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width,initial-scale=1" />',
    needsTailwind ? TAILWIND_CDN_TAG : '',
    '</head><body>',
    trimmed,
    '</body></html>',
  ].join('')
}

export function IframeView(props: IframeViewProps) {
  const mode: IframeMode = props.mode ?? 'srcdoc'
  if (mode === 'live') {
    return <LiveIframeView {...(props as IframeLiveProps)} />
  }
  return <SrcdocIframeView {...(props as IframeSrcdocProps)} />
}

function SrcdocIframeView({ artifactId }: IframeSrcdocProps) {
  const [reloadKey, setReloadKey] = useState(0)

  const artifactQuery = useQuery({
    queryKey: previewQueryKeys.detail(artifactId),
    queryFn: ({ signal }) => fetchArtifactDetail(artifactId, signal),
    enabled: Boolean(artifactId),
    staleTime: 60_000,
  })

  function handleRefresh() {
    artifactQuery.refetch().catch(() => {})
    setReloadKey((value) => value + 1)
  }

  if (artifactQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-primary-500">
        Loading…
      </div>
    )
  }

  if (artifactQuery.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-sm text-red-600">Failed to load artifact</p>
        <p className="text-xs text-primary-500">
          {artifactQuery.error instanceof Error
            ? artifactQuery.error.message
            : 'Unknown error'}
        </p>
      </div>
    )
  }

  const srcDoc = buildSrcDoc(artifactQuery.data?.content ?? '')

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-9 shrink-0 items-center justify-end border-b border-primary-200 bg-primary-50/60 px-2">
        <button
          type="button"
          onClick={handleRefresh}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-primary-700',
            'transition-colors hover:bg-primary-100 hover:text-primary-950',
          )}
        >
          <HugeiconsIcon icon={RefreshIcon} size={14} strokeWidth={1.5} />
          Refresh
        </button>
      </div>
      <iframe
        key={reloadKey}
        title="Artifact HTML preview"
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-forms"
        className="w-full flex-1 border-0 bg-white"
      />
    </div>
  )
}

function LiveIframeView({ runId, reloadKey = 0 }: IframeLiveProps) {
  // The running app handles its own CSS — no Tailwind injection here. The
  // parent RunAppTab manages its own toolbar (refresh / open / stop), so this
  // component just renders the iframe full-bleed for embedding.
  const src = `/preview/${encodeURIComponent(runId)}/`
  return (
    <iframe
      key={`${runId}:${reloadKey}`}
      title="Running app preview"
      src={src}
      sandbox="allow-scripts allow-forms allow-popups allow-modals"
      className="absolute inset-0 h-full w-full border-0 bg-white"
    />
  )
}
