import { HugeiconsIcon } from '@hugeicons/react'
import { BubbleChatIcon, FavouriteIcon, RefreshIcon } from '@hugeicons/core-free-icons'
import type { SimPostSummary } from '@/server/predict-client'
import { cn } from '@/lib/utils'

const PLATFORM_LABEL: Record<string, string> = {
  plaza: 'Info-Plaza',
  community: 'Topic-Community',
}

const PLATFORM_TONE: Record<string, string> = {
  plaza: 'border-sky-500 bg-sky-500/10',
  community: 'border-orange-500 bg-orange-500/10',
}

export function PlatformFeed({
  platform,
  posts,
  liveActions,
  emptyHint,
}: {
  platform: string
  posts: Array<SimPostSummary>
  liveActions?: number
  emptyHint?: string
}) {
  const label = PLATFORM_LABEL[platform] ?? platform
  const toneClass = PLATFORM_TONE[platform] ?? 'border-[var(--theme-border)] bg-[var(--theme-card)]'

  return (
    <article className={cn('flex h-full flex-col rounded-2xl border-2 p-4', toneClass)}>
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide">{label}</h3>
          <div className="text-[10px] text-[var(--theme-muted)]">
            {posts.length} Posts · {liveActions ?? 0} Aktionen total
          </div>
        </div>
      </header>

      {posts.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-[var(--theme-border)] bg-[var(--theme-card)] p-6 text-center text-xs text-[var(--theme-muted)]">
          {emptyHint ?? 'Noch keine Posts auf dieser Plattform.'}
        </div>
      ) : (
        <ul className="flex flex-1 flex-col gap-2 overflow-auto">
          {posts.map((post) => (
            <li
              key={post.id}
              className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 text-xs"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold" title={post.persona_name}>
                  {post.persona_name}
                </span>
                <span className="shrink-0 text-[10px] text-[var(--theme-muted)]">
                  R{post.round_no}{post.parent_id ? ' · reply' : ''}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[var(--theme-text)]">{post.content}</p>
              <footer className="mt-2 flex items-center gap-3 text-[10px] text-[var(--theme-muted)]">
                <span className="flex items-center gap-1">
                  <HugeiconsIcon icon={FavouriteIcon} size={9} />
                  {post.likes}
                </span>
                {post.dislikes > 0 ? (
                  <span className="flex items-center gap-1 text-rose-300">
                    ↓ {post.dislikes}
                  </span>
                ) : null}
                {post.reposts > 0 ? (
                  <span className="flex items-center gap-1 text-emerald-300">
                    <HugeiconsIcon icon={RefreshIcon} size={9} />
                    {post.reposts}
                  </span>
                ) : null}
                {post.parent_id ? (
                  <span className="flex items-center gap-1">
                    <HugeiconsIcon icon={BubbleChatIcon} size={9} />
                    {post.parent_id.slice(-6)}
                  </span>
                ) : null}
              </footer>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
