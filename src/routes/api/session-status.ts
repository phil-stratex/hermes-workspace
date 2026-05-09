import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireWorkspaceAction } from '../../server/route-auth-helpers'
import {
  ensureGatewayProbed,
  getConfig,
  getGatewayCapabilities,
  getSession,
  listSessions,
} from '../../server/claude-api'
import { isSyntheticSessionKey } from '../../server/session-utils'
import { isMultiTenantAuthEnabled } from '../../server/auth-middleware'
import {
  checkSessionVisibility,
  readSessionsMeta,
} from '../../server/sessions-privacy'
import { getLocalSession } from '../../server/local-session-store'
import { readContextUsage } from '@/server/context-usage'

export const Route = createFileRoute('/api/session-status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = requireWorkspaceAction(request, 'chat')
        if (!guard.ok) return guard.response
        await ensureGatewayProbed()
        try {
          const capabilities = getGatewayCapabilities()
          if (!capabilities.sessions) {
            return json({
              ok: true,
              payload: {
                status: 'idle',
                sessionKey: 'new',
                sessionLabel: '',
                model: '',
                modelProvider: '',
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                sessions: [],
              },
            })
          }
          const url = new URL(request.url)
          const requestedKey = url.searchParams.get('sessionKey')?.trim() || ''
          let sessionKey = requestedKey || 'new'

          if (sessionKey === 'new') {
            return json({
              ok: true,
              payload: {
                status: 'idle',
                sessionKey: 'new',
                sessionLabel: '',
                model: '',
                modelProvider: '',
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                sessions: [],
              },
            })
          }

          if (isSyntheticSessionKey(sessionKey)) {
            const sessions = await listSessions(1, 0)
            if (sessions.length === 0) {
              return json({
                ok: true,
                payload: {
                  status: 'idle',
                  sessionKey: 'new',
                  sessionLabel: '',
                  model: '',
                  modelProvider: '',
                  inputTokens: 0,
                  outputTokens: 0,
                  totalTokens: 0,
                  sessions: [],
                },
              })
            }
            sessionKey = sessions[0].id
          }

          // @stratex-patch: multi-tenant privacy check — fixes a leak where
          // any authenticated user could query status (incl. token-counts
          // and session-label) of any session by passing its id as
          // ?sessionKey=. Local sessions (Ollama, Atomic Chat) live in the
          // portable store and are not tagged in sessions-meta — they're
          // user-scoped by their host workspace dir, so we skip the check.
          if (
            isMultiTenantAuthEnabled() &&
            guard.value.user &&
            guard.value.wsId &&
            !getLocalSession(sessionKey)
          ) {
            const meta = readSessionsMeta(guard.value.wsId)
            const visibility = checkSessionVisibility(
              guard.value.user.id,
              sessionKey,
              meta,
            )
            if (visibility.kind === 'not-found') {
              return json({ ok: false, error: 'Not found' }, { status: 404 })
            }
            if (visibility.kind === 'forbidden') {
              return json({ ok: false, error: 'Forbidden' }, { status: 403 })
            }
          }

          const session = await getSession(sessionKey)
          const config = capabilities.config
            ? await getConfig()
            : ({ model: '', provider: '' } as const)

          const inputTokens = session.input_tokens ?? 0
          const outputTokens = session.output_tokens ?? 0
          const contextUsage = await readContextUsage(session.id)

          return json({
            ok: true,
            payload: {
              status: session.ended_at ? 'ended' : 'idle',
              sessionKey: session.id,
              sessionLabel: session.title ?? '',
              model: session.model ?? config.model ?? '',
              modelProvider: config.provider ?? '',
              inputTokens,
              outputTokens,
              totalTokens: inputTokens + outputTokens,
              contextPercent: contextUsage.contextPercent,
              maxTokens: contextUsage.maxTokens,
              usedTokens: contextUsage.usedTokens,
              sessions: [
                {
                  key: session.id,
                  agentId: session.id,
                  label: session.title ?? session.id,
                  model: session.model ?? config.model ?? '',
                  modelProvider: config.provider ?? '',
                  updatedAt: session.last_active ?? session.started_at ?? 0,
                  usage: {
                    input: inputTokens,
                    output: outputTokens,
                  },
                },
              ],
            },
          })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 503 },
          )
        }
      },
    },
  },
})
