import type { MeResponse } from '@/lib/workspace-auth'

export type SharedSessionReadOnlyBannerProps = {
  sharedBy?: string
  ownerId?: string
  currentUser?: MeResponse['user'] | null
  onRequestUnshare?: () => void
}

/**
 * Read-only banner shown above a shared session for non-owner viewers.
 * Plan-Finding F11: shared sessions are read-only for everyone except
 * the original owner — the banner explains the state and disables
 * any "send" controls upstream.
 *
 * Renders nothing when the caller is the owner.
 */
export function SharedSessionReadOnlyBanner(props: SharedSessionReadOnlyBannerProps) {
  if (!props.ownerId) return null
  if (props.currentUser && props.currentUser.id === props.ownerId) return null

  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
      <span aria-hidden>👁</span>
      <span>
        Geteilt von <strong>{props.sharedBy ?? props.ownerId}</strong> — nur Lesezugriff. Nur der Owner kann hier weiterschreiben.
      </span>
      {props.onRequestUnshare && (
        <button
          type="button"
          onClick={props.onRequestUnshare}
          className="ml-auto rounded p-0.5 text-amber-700 underline hover:no-underline"
        >
          Schließen
        </button>
      )}
    </div>
  )
}
