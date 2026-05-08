import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { createHighlighter } from 'shiki'
import { fetchArtifactDetail, previewQueryKeys } from './_api'
import { getLanguageFromPath } from './_helpers'
import type { BundledLanguage, Highlighter } from 'shiki'
import { useResolvedTheme } from '@/hooks/use-chat-settings'
import { writeTextToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

type CodeViewProps = {
  artifactId: string
  path: string
}

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['vitesse-light', 'vitesse-dark'],
      langs: ['text'],
    })
  }
  return highlighterPromise
}

export function CodeView({ artifactId, path }: CodeViewProps) {
  const resolvedTheme = useResolvedTheme()
  const themeName = resolvedTheme === 'dark' ? 'vitesse-dark' : 'vitesse-light'
  const language = useMemo(() => getLanguageFromPath(path), [path])

  const artifactQuery = useQuery({
    queryKey: previewQueryKeys.detail(artifactId),
    queryFn: ({ signal }) => fetchArtifactDetail(artifactId, signal),
    enabled: Boolean(artifactId),
    staleTime: 60_000,
  })

  const content = artifactQuery.data?.content ?? ''
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const lineCount = useMemo(
    () => Math.max(1, content.split('\n').length),
    [content],
  )

  useEffect(() => {
    if (!content) {
      setHtml(null)
      return
    }
    let active = true
    getHighlighter()
      .then(async (highlighter) => {
        let lang: string = language
        if (lang !== 'text') {
          try {
            await highlighter.loadLanguage(lang as BundledLanguage)
          } catch {
            lang = 'text'
          }
        }
        const highlighted = highlighter.codeToHtml(content, {
          lang: lang as BundledLanguage,
          theme: themeName,
        })
        if (active) setHtml(highlighted)
      })
      .catch(() => {
        if (active) setHtml(null)
      })
    return () => {
      active = false
    }
  }, [content, language, themeName])

  async function handleCopy() {
    try {
      await writeTextToClipboard(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
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

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <button
        type="button"
        onClick={() => {
          handleCopy().catch(() => {})
        }}
        aria-label="Copy artifact contents"
        className={cn(
          'absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border border-primary-200 bg-primary-50/95 px-2 py-1 text-xs font-medium text-primary-700 shadow-sm',
          'transition-colors hover:bg-primary-100',
        )}
      >
        <HugeiconsIcon
          icon={copied ? Tick02Icon : Copy01Icon}
          size={14}
          strokeWidth={1.5}
        />
        {copied ? 'Copied' : 'Copy'}
      </button>
      <div className="flex h-full min-h-0 overflow-auto">
        <ol
          className="sticky left-0 z-[1] select-none border-r border-primary-200 bg-primary-50/80 px-2 py-3 text-right text-xs leading-6 text-primary-500 tabular-nums"
          aria-hidden="true"
        >
          {Array.from({ length: lineCount }, (_, index) => (
            <li key={`line-${index + 1}`}>{index + 1}</li>
          ))}
        </ol>
        <div className="min-w-0 flex-1">
          {html ? (
            <div
              className="text-sm leading-6 text-primary-900 [&>pre]:m-0 [&>pre]:bg-transparent [&>pre]:px-3 [&>pre]:py-3"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <pre className="m-0 px-3 py-3 text-sm leading-6 text-primary-900 whitespace-pre">
              <code>{content}</code>
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
