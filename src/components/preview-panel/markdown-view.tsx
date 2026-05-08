import { useQuery } from '@tanstack/react-query'
import { fetchArtifactDetail, previewQueryKeys } from './_api'
import { Markdown } from '@/components/prompt-kit/markdown'
import { cn } from '@/lib/utils'

type MarkdownViewProps = {
  artifactId: string
}

export function MarkdownView({ artifactId }: MarkdownViewProps) {
  const artifactQuery = useQuery({
    queryKey: previewQueryKeys.detail(artifactId),
    queryFn: ({ signal }) => fetchArtifactDetail(artifactId, signal),
    enabled: Boolean(artifactId),
    staleTime: 60_000,
  })

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

  const content = artifactQuery.data?.content ?? ''

  return (
    <div className="h-full min-h-0 overflow-auto bg-primary-50">
      <div
        className={cn(
          'prose prose-sm max-w-none px-5 py-4',
          'prose-headings:text-primary-950 prose-p:text-primary-900',
        )}
      >
        <Markdown>{content}</Markdown>
      </div>
    </div>
  )
}
