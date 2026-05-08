import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'

import {
  createSessionCookie,
  getRequestIp,
  isMultiTenantAuthEnabled,
  issueUserSessionToken,
} from '../../server/auth-middleware'
import { hashPassword } from '../../server/auth-passwords'
import { appendAuditEvent } from '../../server/audit-log'
import { describeBootState } from '../../server/boot-state-check'
import { writeMarker } from '../../server/migration-marker'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'
import { isValidSlug } from '../../server/data-paths'
import { createUser, listUsers, setPasswordHash, updateUserProfile } from '../../server/users-store'
import { addMember, createWorkspace } from '../../server/workspace-store'

/**
 * POST /api/auth/setup — first-run-only.
 *
 * Triggered by the SetupWizard on a fresh stack. Creates the first
 * owner account + first workspace, persists the migration marker so
 * subsequent boots take the multi-tenant path, and auto-logs the
 * caller in.
 *
 * Refuses if any users already exist OR the migration marker is
 * already valid — no second-bootstrap.
 */

const SetupSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().email().max(320),
    name: z.string().min(1).max(200),
    password: z.string().min(8).max(1000),
  }),
  workspace: z.object({
    id: z.string(),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }),
})

export const Route = createFileRoute('/api/auth/setup')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const ip = getClientIp(request)
        if (!rateLimit(`auth:setup:${ip}`, 5, 60_000)) return rateLimitResponse()

        // Refuse if not in fresh-stack state
        const state = describeBootState()
        if (state.usersExist || isMultiTenantAuthEnabled()) {
          return json(
            { ok: false, error: 'Setup already completed' },
            { status: 409 },
          )
        }

        const raw = await request.json().catch(() => ({}))
        const parsed = SetupSchema.safeParse(raw)
        if (!parsed.success) {
          return json(
            { ok: false, error: 'Invalid request', issues: parsed.error.issues },
            { status: 400 },
          )
        }

        if (!isValidSlug(parsed.data.user.id)) {
          return json({ ok: false, error: 'Invalid user.id (slug expected)' }, { status: 400 })
        }
        if (!isValidSlug(parsed.data.workspace.id)) {
          return json({ ok: false, error: 'Invalid workspace.id (slug expected)' }, { status: 400 })
        }

        // Defensive: another concurrent setup might have created a user already
        if (listUsers().length > 0) {
          return json({ ok: false, error: 'Setup already completed' }, { status: 409 })
        }

        // 1) Create owner profile + password
        await createUser({
          id: parsed.data.user.id,
          email: parsed.data.user.email,
          name: parsed.data.user.name,
          status: 'active',
          mustChangePassword: false,
        })
        const hash = await hashPassword(parsed.data.user.password)
        await setPasswordHash(parsed.data.user.id, hash)

        // 2) Create the first workspace + put owner inside
        const wsMeta = await createWorkspace({
          id: parsed.data.workspace.id,
          name: parsed.data.workspace.name,
          description: parsed.data.workspace.description,
          createdBy: parsed.data.user.id,
          branding: parsed.data.workspace.primaryColor
            ? { primaryColor: parsed.data.workspace.primaryColor }
            : undefined,
        })
        await addMember({
          wsId: parsed.data.workspace.id,
          userId: parsed.data.user.id,
          role: 'owner',
          addedBy: parsed.data.user.id,
        })
        await updateUserProfile(parsed.data.user.id, (p) =>
          p ? { ...p, defaultWorkspaceId: parsed.data.workspace.id } : null,
        )

        // 3) Persist migration marker so boot takes multi-tenant path next time
        writeMarker()

        // 4) Audit
        await appendAuditEvent('global', {
          type: 'setup_completed',
          userId: parsed.data.user.id,
          workspaceId: parsed.data.workspace.id,
          ip: getRequestIp(request),
        })
        await appendAuditEvent(
          { type: 'workspace', wsId: parsed.data.workspace.id },
          { type: 'workspace_created', userId: parsed.data.user.id },
        )

        // 5) Auto-login
        const token = await issueUserSessionToken({
          userId: parsed.data.user.id,
          ip: getRequestIp(request),
          userAgent: request.headers.get('user-agent') ?? undefined,
        })
        return json(
          {
            ok: true,
            user: { id: parsed.data.user.id, name: parsed.data.user.name, email: parsed.data.user.email },
            workspace: { id: wsMeta.id, name: wsMeta.name },
          },
          { status: 200, headers: { 'Set-Cookie': createSessionCookie(token) } },
        )
      },
    },
  },
})
