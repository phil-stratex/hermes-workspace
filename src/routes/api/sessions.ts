import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { writeJsonAtomic, withMutex } from '../../server/atomic-write'
import { requireJsonContentType } from '../../server/rate-limit'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  createSession,
  deleteSession,
  ensureGatewayProbed,
  getGatewayCapabilities,
  listSessions,
  toSessionSummary,
  updateSession,
} from '../../server/claude-api'
import { createCapabilityUnavailablePayload } from '@/lib/feature-gates'
import {
  deleteLocalSession,
  getLocalMessages,
  getLocalSession,
  listLocalSessions,
} from '../../server/local-session-store'

// Local patch: persistent session titles for zero-fork mode where the
// upstream gateway doesn't accept session label updates.
const TITLES_FILE = path.join(
  process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes'),
  'session-titles.json',
)
function readSessionTitles(): Record<string, string> {
  try {
    const raw = fs.readFileSync(TITLES_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') out[k] = v
      }
      return out
    }
  } catch {
    // missing or invalid — start empty
  }
  return {}
}
function writeSessionTitle(key: string, title: string): Promise<void> {
  // Serialise read-modify-write per file path so concurrent PATCH calls
  // can't lose updates (one read => map mutation => atomic rename).
  return withMutex(TITLES_FILE, () => {
    const map = readSessionTitles()
    map[key] = title
    try {
      fs.mkdirSync(path.dirname(TITLES_FILE), { recursive: true })
      writeJsonAtomic(TITLES_FILE, map)
    } catch {
      // best-effort; UI still has the optimistic update
    }
  })
}
function applyStoredTitles<T extends Record<string, unknown>>(
  sessions: Array<T>,
): Array<T> {
  const titles = readSessionTitles()
  if (Object.keys(titles).length === 0) return sessions
  return sessions.map((s) => {
    const ids = [s.key, s.id, s.friendlyId].filter(
      (v): v is string => typeof v === 'string',
    )
    const stored = ids.map((id) => titles[id]).find(Boolean)
    if (!stored) return s
    return { ...s, label: stored, title: stored, derivedTitle: stored }
  })
}

// Derive a sidebar-friendly title from the first user message of a local
// session whose backend-side title is still the placeholder "Local Chat".
// Frontend's auto-title hook can race with the listSessions refetch and the
// sidebar fallback shows "Session <hex>" until the hook lands its PATCH —
// doing this server-side guarantees a real title on the very next refetch
// and persists it via writeSessionTitle so applyStoredTitles handles it
// from then on.
const MAX_DERIVED_TITLE_LENGTH = 50
const PLACEHOLDER_TITLES = new Set(['', 'Local Chat'])

function truncateForTitle(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length === 0) return ''
  if (normalized.length <= MAX_DERIVED_TITLE_LENGTH) return normalized
  return `${normalized.slice(0, MAX_DERIVED_TITLE_LENGTH - 1).trimEnd()}…`
}

function withDerivedLocalTitles<T extends Record<string, unknown>>(
  sessions: Array<T>,
): Array<T> {
  return sessions.map((s) => {
    if (s.source !== 'local') return s
    const titleStr = typeof s.title === 'string' ? s.title.trim() : ''
    const labelStr = typeof s.label === 'string' ? s.label.trim() : ''
    if (labelStr && !PLACEHOLDER_TITLES.has(labelStr)) return s
    if (titleStr && !PLACEHOLDER_TITLES.has(titleStr) && labelStr) return s

    const sessionId = typeof s.id === 'string' ? s.id : typeof s.key === 'string' ? s.key : ''
    if (!sessionId) return s
    const messages = getLocalMessages(sessionId)
    const firstUser = messages.find((m) => m.role === 'user')
    if (!firstUser) return s
    const content = typeof firstUser.content === 'string' ? firstUser.content : ''
    const derived = truncateForTitle(content)
    if (!derived) return s

    // Fire-and-forget persistence — next GET reads it via applyStoredTitles
    // (which serialises read-modify-write under withMutex).
    void writeSessionTitle(sessionId, derived)

    return { ...s, label: derived, title: derived, derivedTitle: derived }
  })
}

export const Route = createFileRoute('/api/sessions')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Auth check
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const capabilities = await ensureGatewayProbed()
        if (!capabilities.sessions) {
          return json({
            ok: true,
            sessions: [],
            source: 'unavailable',
            message: SESSIONS_API_UNAVAILABLE_MESSAGE,
          })
        }

        try {
          const sessions = await listSessions(50, 0)
          const gatewaySessions = sessions.map(toSessionSummary)

          // Merge local portable sessions (Ollama, Atomic Chat, etc.)
          const localSessions = listLocalSessions()
          const gatewayIds = new Set(gatewaySessions.map((s: any) => s.key || s.id))
          for (const ls of localSessions) {
            if (!gatewayIds.has(ls.id)) {
              gatewaySessions.push({
                key: ls.id,
                id: ls.id,
                title: ls.title || 'Local Chat',
                startedAt: ls.createdAt,
                updatedAt: ls.updatedAt,
                message_count: ls.messageCount,
                model: ls.model,
                source: 'local',
              } as any)
            }
          }

          return json({
            sessions: withDerivedLocalTitles(applyStoredTitles(gatewaySessions)),
          })
        } catch (err) {
          return json(
            {
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheckPost = requireJsonContentType(request)
        if (csrfCheckPost) return csrfCheckPost
        const capabilities = await ensureGatewayProbed()
        if (!capabilities.sessions) {
          const friendlyId = randomUUID()
          return json({
            ...createCapabilityUnavailablePayload('sessions'),
            ok: true,
            sessionKey: friendlyId,
            friendlyId,
            persisted: false,
          })
        }
        try {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >

          const requestedLabel =
            typeof body.label === 'string' ? body.label.trim() : ''
          const label = requestedLabel || undefined

          const requestedFriendlyId =
            typeof body.friendlyId === 'string' ? body.friendlyId.trim() : ''
          const friendlyId = requestedFriendlyId || randomUUID()

          const requestedModel =
            typeof body.model === 'string' ? body.model.trim() : ''
          const model = requestedModel || undefined

          if (capabilities.dashboard.available && !capabilities.enhancedChat) {
            return json({
              ok: true,
              sessionKey: friendlyId,
              friendlyId,
              entry: {
                key: friendlyId,
                id: friendlyId,
                title: label || friendlyId,
                label: label || friendlyId,
                derivedTitle: label || friendlyId,
                model: model || '',
                startedAt: Date.now(),
                updatedAt: Date.now(),
                message_count: 0,
                source: 'dashboard',
              },
              modelApplied: Boolean(model),
              persisted: false,
            })
          }

          const session = await createSession({
            id: friendlyId || randomUUID(),
            title: label,
            model,
          })

          return json({
            ok: true,
            sessionKey: session.id,
            friendlyId: session.id,
            entry: toSessionSummary(session),
            modelApplied: true,
          })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
      PATCH: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheckPatch = requireJsonContentType(request)
        if (csrfCheckPatch) return csrfCheckPatch
        const capabilities = await ensureGatewayProbed()
        if (!capabilities.sessions) {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >
          const rawSessionKey =
            typeof body.sessionKey === 'string' ? body.sessionKey.trim() : ''
          const rawFriendlyId =
            typeof body.friendlyId === 'string' ? body.friendlyId.trim() : ''
          const sessionKey = rawSessionKey || rawFriendlyId || randomUUID()

          return json({
            ...createCapabilityUnavailablePayload('sessions'),
            ok: true,
            sessionKey,
            friendlyId: rawFriendlyId || sessionKey,
            updated: false,
          })
        }
        try {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >

          const rawSessionKey =
            typeof body.sessionKey === 'string' ? body.sessionKey.trim() : ''
          const rawFriendlyId =
            typeof body.friendlyId === 'string' ? body.friendlyId.trim() : ''
          const label =
            typeof body.label === 'string' ? body.label.trim() : undefined
          const sessionKey = rawSessionKey || rawFriendlyId

          if (!sessionKey) {
            return json(
              { ok: false, error: 'sessionKey required' },
              { status: 400 },
            )
          }

          if (capabilities.dashboard.available && !capabilities.enhancedChat) {
            // Zero-fork mode: backend gateway can't accept session updates,
            // so we persist titles locally in HERMES_HOME/session-titles.json.
            if (label) await writeSessionTitle(sessionKey, label)
            if (rawFriendlyId && rawFriendlyId !== sessionKey && label) {
              await writeSessionTitle(rawFriendlyId, label)
            }
            return json({
              ok: true,
              sessionKey,
              entry: {
                key: sessionKey,
                id: sessionKey,
                friendlyId: rawFriendlyId || sessionKey,
                title: label || sessionKey,
                label: label || sessionKey,
                derivedTitle: label || sessionKey,
                updatedAt: Date.now(),
              },
              updated: true,
            })
          }

          const session = await updateSession(sessionKey, {
            title: label,
          })

          return json({
            ok: true,
            sessionKey,
            entry: toSessionSummary(session),
          })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
      DELETE: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const rawSessionKey = url.searchParams.get('sessionKey') ?? ''
        const rawFriendlyId = url.searchParams.get('friendlyId') ?? ''
        const sessionKey = rawSessionKey.trim() || rawFriendlyId.trim()

        if (!sessionKey) {
          return json(
            { ok: false, error: 'sessionKey required' },
            { status: 400 },
          )
        }

        // Local sessions live in the workspace portable store, not the
        // gateway. Delete them locally without hitting the gateway.
        if (getLocalSession(sessionKey)) {
          deleteLocalSession(sessionKey)
          return json({ ok: true, sessionKey, source: 'local' })
        }

        const capabilities = await ensureGatewayProbed()
        if (!capabilities.sessions) {
          return json({
            ...createCapabilityUnavailablePayload('sessions'),
            ok: true,
            sessionKey,
            deleted: false,
          })
        }
        try {
          await deleteSession(sessionKey)

          return json({ ok: true, sessionKey })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
