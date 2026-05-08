/**
 * POST /api/errors/export
 *
 * Body: `{ errorIds: string[], includeRelatedLogs?: boolean }`
 * Returns: `{ ok, markdown, count, missing }`
 *
 * Generates the Builder-Brief Markdown so the UI can present a
 * preview-and-copy modal. The `markdown` is plain text — caller is
 * responsible for clipboard / download.
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

import { requireStackAdmin } from '../../server/error-acl'
import { formatErrorsAsMarkdown } from '../../server/builder-brief'
import { requireJsonContentType } from '../../server/rate-limit'

const MAX_IDS = 100

export const Route = createFileRoute('/api/errors/export')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = requireStackAdmin(request)
        if (!guard.ok) return guard.response
        const csrf = requireJsonContentType(request)
        if (csrf) return csrf

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return json({ ok: false, error: 'invalid-json' }, { status: 400 })
        }
        if (!body || typeof body !== 'object') {
          return json({ ok: false, error: 'expected object body' }, { status: 400 })
        }
        const { errorIds, includeRelatedLogs } = body as {
          errorIds?: unknown
          includeRelatedLogs?: unknown
        }
        if (!Array.isArray(errorIds) || errorIds.length === 0) {
          return json({ ok: false, error: 'errorIds required' }, { status: 400 })
        }
        if (errorIds.length > MAX_IDS) {
          return json(
            { ok: false, error: `too many ids (max ${MAX_IDS})` },
            { status: 400 },
          )
        }
        const idStrs: Array<string> = []
        for (const id of errorIds) {
          if (typeof id !== 'string' || !id.trim()) {
            return json({ ok: false, error: 'errorIds must be non-empty strings' }, { status: 400 })
          }
          idStrs.push(id.trim())
        }
        const result = formatErrorsAsMarkdown({
          errorIds: idStrs,
          includeRelatedLogs: includeRelatedLogs === true,
        })
        return json({ ok: true, ...result })
      },
    },
  },
})
