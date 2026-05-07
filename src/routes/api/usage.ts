/**
 * Usage / Cost telemetry — aggregates token counts and call counts
 * from the workspace's locally-known sources:
 *
 *   - Council session records (from /opt/data/council/sessions/*.json)
 *     → exact token totals per mode + chairman.
 *   - Hermes API sessions (from /opt/data/sessions/session_api-*.json)
 *     → message counts and model usage. We don't get raw token usage
 *       there because Hermes doesn't persist `usage` in those files —
 *       we expose message_count as a proxy.
 *
 * Window slices: last 24h / 7d / 30d / all.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'

const HERMES_HOME =
  process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes')
const COUNCIL_DIR = path.join(HERMES_HOME, 'council', 'sessions')
const SESSIONS_DIR = path.join(HERMES_HOME, 'sessions')

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

function readSessionStats(sinceMs: number): SessionStats {
  const stats: SessionStats = {
    total: 0,
    totalMessages: 0,
    perModel: {},
  }
  if (!fs.existsSync(SESSIONS_DIR)) return stats
  const entries = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'))
  for (const f of entries) {
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
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const win =
          (url.searchParams.get('window') as keyof typeof WINDOWS_MS) ?? '7d'
        const cutoff = WINDOWS_MS[win]
          ? Date.now() - WINDOWS_MS[win]
          : 0 // 'all' or unknown → no cutoff
        return json({
          ok: true,
          window: win,
          cutoff,
          generatedAt: Date.now(),
          council: readCouncilStats(cutoff),
          sessions: readSessionStats(cutoff),
        })
      },
    },
  },
})
