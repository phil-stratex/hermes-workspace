/**
 * Usage / Cost telemetry — workspace-scoped aggregation.
 *
 * Sources:
 *   - Hermes API sessions (`HERMES_HOME/sessions/session_api-<hex>.json`)
 *     are filtered against the **active workspace's** `sessions-meta.json`
 *     — only sessions tagged as belonging to this workspace count. New
 *     workspaces start at zero; the migrated default workspace (Stratex)
 *     sees its full history.
 *   - Council session records (`HERMES_HOME/council/sessions/*.json`)
 *     have no workspace tags yet. We surface them only for the
 *     migration-default workspace (env `DEFAULT_WORKSPACE_ID`, fallback
 *     `stratex`); other workspaces see council=null until the council
 *     data path itself is wsId-keyed.
 *
 * Window slices: last 24h / 7d / 30d / all.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireWorkspaceAction } from '../../server/route-auth-helpers'
import { readSessionsMeta } from '../../server/sessions-privacy'

const HERMES_HOME =
  process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes')
const COUNCIL_DIR = path.join(HERMES_HOME, 'council', 'sessions')
const SESSIONS_DIR = path.join(HERMES_HOME, 'sessions')
const DEFAULT_WORKSPACE_ID = process.env.DEFAULT_WORKSPACE_ID ?? 'stratex'

const WINDOWS_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

type CouncilStats = {
  total: number
  totalTokens: number
  perMode: Record<string, { count: number; tokens: number }>
  perChairman: Record<string, { count: number; tokens: number }>
  recent: Array<{
    id: string
    startedAt: number
    mode: string
    chairman: string
    totalTokens: number | null
    question: string
  }>
}

type SessionStats = {
  total: number
  totalMessages: number
  perModel: Record<string, { count: number; messages: number }>
}

function readCouncilStats(sinceMs: number): CouncilStats {
  const stats: CouncilStats = {
    total: 0,
    totalTokens: 0,
    perMode: {},
    perChairman: {},
    recent: [],
  }
  if (!fs.existsSync(COUNCIL_DIR)) return stats
  const entries = fs
    .readdirSync(COUNCIL_DIR)
    .filter((f) => f.endsWith('.json'))
  for (const f of entries) {
    try {
      const raw = fs.readFileSync(path.join(COUNCIL_DIR, f), 'utf-8')
      const r = JSON.parse(raw) as {
        id?: string
        startedAt?: number
        mode?: string
        chairman?: string
        totalTokens?: number | null
        question?: string
      }
      const ts = r.startedAt ?? 0
      if (sinceMs > 0 && ts < sinceMs) continue
      stats.total += 1
      const tokens = typeof r.totalTokens === 'number' ? r.totalTokens : 0
      stats.totalTokens += tokens
      const mode = r.mode ?? 'unknown'
      const chair = r.chairman ?? 'unknown'
      stats.perMode[mode] ??= { count: 0, tokens: 0 }
      stats.perMode[mode].count += 1
      stats.perMode[mode].tokens += tokens
      stats.perChairman[chair] ??= { count: 0, tokens: 0 }
      stats.perChairman[chair].count += 1
      stats.perChairman[chair].tokens += tokens
      stats.recent.push({
        id: r.id ?? f,
        startedAt: ts,
        mode,
        chairman: chair,
        totalTokens: r.totalTokens ?? null,
        question: (r.question ?? '').slice(0, 200),
      })
    } catch {
      /* skip broken entries */
    }
  }
  stats.recent.sort((a, b) => b.startedAt - a.startedAt)
  stats.recent = stats.recent.slice(0, 20)
  return stats
}

function extractSessionId(filename: string): string | null {
  // Hermes writes `session_api-<hex>.json` per request — extract the hex
  // portion so we can cross-reference against the workspace meta.
  const m = filename.match(/^session_api-([0-9a-f]+)\.json$/i)
  return m ? m[1] : null
}

function readSessionStats(sinceMs: number, wsId: string | null): SessionStats {
  const stats: SessionStats = {
    total: 0,
    totalMessages: 0,
    perModel: {},
  }
  if (!fs.existsSync(SESSIONS_DIR)) return stats
  // Build the allow-set of session IDs that belong to this workspace.
  // Without a wsId (legacy) the gate has already failed elsewhere — but
  // surface an empty stat rather than leaking everything.
  if (!wsId) return stats
  const meta = readSessionsMeta(wsId)
  const allowed = new Set(Object.keys(meta.sessions ?? {}))
  if (allowed.size === 0) return stats

  const entries = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'))
  for (const f of entries) {
    const sid = extractSessionId(f)
    if (!sid || !allowed.has(sid)) continue
    try {
      const stat = fs.statSync(path.join(SESSIONS_DIR, f))
      if (sinceMs > 0 && stat.mtimeMs < sinceMs) continue
      const raw = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8')
      const r = JSON.parse(raw) as {
        model?: string
        message_count?: number
      }
      stats.total += 1
      const msgs = typeof r.message_count === 'number' ? r.message_count : 0
      stats.totalMessages += msgs
      const model = r.model ?? 'unknown'
      stats.perModel[model] ??= { count: 0, messages: 0 }
      stats.perModel[model].count += 1
      stats.perModel[model].messages += msgs
    } catch {
      /* skip */
    }
  }
  return stats
}

export const Route = createFileRoute('/api/usage')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = requireWorkspaceAction(request, 'view-usage')
        if (!guard.ok) return guard.response
        const url = new URL(request.url)
        const win =
          (url.searchParams.get('window') as keyof typeof WINDOWS_MS) ?? '7d'
        const cutoff = WINDOWS_MS[win]
          ? Date.now() - WINDOWS_MS[win]
          : 0 // 'all' or unknown → no cutoff
        const wsId = guard.value.wsId
        // Council data has no workspaceId tags yet. Show full history only
        // to the migration-default workspace; other workspaces see empty
        // until the council data path is itself wsId-keyed.
        const councilStats =
          wsId === DEFAULT_WORKSPACE_ID
            ? readCouncilStats(cutoff)
            : { total: 0, totalTokens: 0, perMode: {}, perChairman: {}, recent: [] }
        return json({
          ok: true,
          window: win,
          workspaceId: wsId,
          cutoff,
          generatedAt: Date.now(),
          council: councilStats,
          sessions: readSessionStats(cutoff, wsId),
        })
      },
    },
  },
})
