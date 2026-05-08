import type { Ref, RefObject } from 'react'

import {
  SharedSessionReadOnlyBanner,
  useSharedSessionReadOnlyState,
} from '@/components/workspace/shared-session-read-only-banner'
import { ChatComposer } from './chat-composer'
import type { ChatComposerHandle } from './chat-composer'

/**
 * Chat-composer wrapper that gates writes for non-owner viewers of a
 * shared session (Plan-Finding F11).
 *
 * Renders the read-only banner above the composer, disables Send when
 * the active session is in `shared && !isOwner` state, and otherwise
 * passes through every prop unchanged. The hook returns
 * `loading=true` on first render — we keep the composer enabled
 * during loading so a brief network blip doesn't disable typing on
 * private sessions.
 */
export function ComposerWithReadOnlyGuard(props: {
  activeFriendlyId: string
  isNewChat: boolean
  forcedSessionKey?: string | null
  resolvedSessionKey?: string | null
  activeSessionKey: string
  activeCanonicalKey?: string | null
  composerRef: Ref<HTMLDivElement>
  composerHandleRef: RefObject<ChatComposerHandle | null>
  embedded?: boolean
  hideUi?: boolean
  sending: boolean
  waitingForResponse: boolean
  thinkingLevel: 'off' | 'low' | 'medium' | 'high' | 'adaptive'
  onSubmit: React.ComponentProps<typeof ChatComposer>['onSubmit']
  onAbort: () => void
  onThinkingLevelChange: (level: 'off' | 'low' | 'medium' | 'high' | 'adaptive') => void
}) {
  const sessionId = props.isNewChat
    ? null
    : props.forcedSessionKey || props.resolvedSessionKey || props.activeSessionKey || null

  const { readOnly } = useSharedSessionReadOnlyState(sessionId)

  return (
    <>
      {sessionId && <SharedSessionReadOnlyBanner sessionId={sessionId} />}
      <ChatComposer
        onSubmit={props.onSubmit}
        onAbort={props.onAbort}
        isLoading={props.sending || props.waitingForResponse}
        disabled={props.sending || Boolean(props.hideUi) || readOnly}
        sessionKey={sessionId ?? undefined}
        wrapperRef={props.composerRef}
        composerRef={props.composerHandleRef}
        embedded={props.embedded}
        focusKey={`${props.isNewChat ? 'new' : props.activeFriendlyId}:${props.activeCanonicalKey ?? ''}`}
        thinkingLevel={props.thinkingLevel}
        onThinkingLevelChange={props.onThinkingLevelChange}
      />
    </>
  )
}
