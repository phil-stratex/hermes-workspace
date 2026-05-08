import { createFileRoute } from '@tanstack/react-router'

import { LoginScreen } from '@/components/auth/login-screen'

/**
 * Public invite-accept route. The LoginScreen detects the URL and
 * renders the InviteAcceptForm — even when the visitor is already
 * logged in elsewhere, since accepting an invite creates a NEW user
 * (the existing session-cookie is overwritten on success).
 *
 * No server-side auth check: the underlying API endpoints
 * (`/api/invites/$token/info`, `/api/invites/$token/accept`) are
 * themselves public and rate-limited.
 */
export const Route = createFileRoute('/invite/$token')({
  component: InvitePage,
})

function InvitePage() {
  return <LoginScreen />
}
