/**
 * Frontend helpers for the multi-tenant auth surface (Phase A.6 UI).
 *
 * Each function corresponds to one of the routes shipped in Phase
 * A.2/A.3. They throw a typed `AuthError` on non-2xx so callers can
 * branch on `kind` for in-component error states.
 */

export type SetupStatus =
  | { ok: true; mode: 'fresh-stack' }
  | { ok: true; mode: 'multi-tenant' }
  | { ok: true; mode: 'legacy'; authRequired: boolean }
  | { ok: true; mode: 'inconsistent'; hint: string }

export type Membership = {
  workspaceId: string
  name: string
  role: 'owner' | 'admin' | 'member'
  branding: { primaryColor: string; logoUrl?: string }
  joinedAt: string
}

export type CurrentUser = {
  id: string
  email: string
  name: string
  status: 'active' | 'disabled' | 'locked'
  mustChangePassword: boolean
  defaultWorkspaceId?: string
  lastLoginAt?: string
}

export type MeResponse = {
  ok: true
  mode: 'multi-tenant'
  user: CurrentUser
  memberships: Array<Membership>
  activeWorkspaceId?: string
  actions: Array<string>
}

export type InviteInfo =
  | { ok: true; valid: false; reason?: string }
  | {
      ok: true
      valid: true
      workspace: { id: string; name: string; branding: { primaryColor: string } }
      email?: string
      role: 'admin' | 'member'
      expiresAt: string
    }

export class AuthError extends Error {
  constructor(
    public readonly kind:
      | 'invalid-credentials'
      | 'locked'
      | 'disabled'
      | 'must-change-password'
      | 'not-allowed'
      | 'rate-limited'
      | 'invalid-request'
      | 'server-error'
      | 'mode-mismatch'
      | 'invite-invalid'
      | 'conflict',
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    credentials: 'same-origin',
  })
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text.length > 0 ? JSON.parse(text) : {}
  } catch {
    // non-JSON — fall through
  }
  if (!res.ok) {
    const errMsg = (data as { error?: string }).error ?? `HTTP ${res.status}`
    throw new AuthError(mapStatusToKind(res.status), errMsg, res.status)
  }
  return data as T
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin' })
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text.length > 0 ? JSON.parse(text) : {}
  } catch {
    // ignore
  }
  if (!res.ok) {
    const errMsg = (data as { error?: string }).error ?? `HTTP ${res.status}`
    throw new AuthError(mapStatusToKind(res.status), errMsg, res.status)
  }
  return data as T
}

function mapStatusToKind(status: number): AuthError['kind'] {
  if (status === 401) return 'invalid-credentials'
  if (status === 403) return 'disabled'
  if (status === 423) return 'locked'
  if (status === 412) return 'mode-mismatch'
  if (status === 429) return 'rate-limited'
  if (status === 410) return 'invite-invalid'
  if (status === 409) return 'conflict'
  if (status === 400) return 'invalid-request'
  return 'server-error'
}

// ─── Endpoints ────────────────────────────────────────────────────────

export async function fetchSetupStatus(): Promise<SetupStatus> {
  return getJson<SetupStatus>('/api/setup-status')
}

export type LoginResponse = { ok: true; userId: string }

export async function loginWithEmailPassword(
  identifier: string,
  password: string,
): Promise<LoginResponse> {
  // The server endpoint accepts either { email } or { identifier };
  // we send `identifier` so userId-slug logins work transparently.
  return postJson<LoginResponse>('/api/auth/login', { identifier, password })
}

export async function logout(): Promise<void> {
  await postJson('/api/auth/logout', {})
}

export async function fetchCurrentUser(): Promise<MeResponse | { ok: true; user: null; mode: 'legacy' }> {
  return getJson('/api/auth/me')
}

export type SetupInput = {
  user: { id: string; email: string; name: string; password: string }
  workspace: {
    id: string
    name: string
    description?: string
    primaryColor?: string
  }
}

export async function performSetup(input: SetupInput): Promise<{ ok: true; userId: string; workspaceId: string }> {
  return postJson('/api/auth/setup', input)
}

export async function fetchInviteInfo(token: string): Promise<InviteInfo> {
  return getJson(`/api/invites/${encodeURIComponent(token)}/info`)
}

export type AcceptInviteInput = {
  userId: string
  name: string
  password: string
}

export async function acceptInvite(
  token: string,
  input: AcceptInviteInput,
): Promise<{ ok: true; userId: string; workspaceId: string }> {
  return postJson(`/api/invites/${encodeURIComponent(token)}/accept`, input)
}

export async function changePassword(
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  await postJson('/api/auth/change-password', { oldPassword, newPassword })
}

export async function switchWorkspace(workspaceId: string): Promise<{ activeWorkspaceId: string }> {
  return postJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/switch`, {})
}

// ─── Slug validation (mirrors server-side rules) ───────────────────────

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s)
}

export function suggestSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'workspace'
}
