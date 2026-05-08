/**
 * Multi-person migration heuristic (Plan-Finding L2).
 *
 * The legacy single-tenant stack tagged every gateway session with
 * the same single-password identity. When migrating, we have to pick
 * ONE user-id to attach those existing sessions to — but if multiple
 * humans were sharing the legacy password, blindly tagging them all
 * to a single migrant silently steals chat histories from the others.
 *
 * Heuristic — flag as "multi-person likely" when EITHER:
 *   - more than 20 distinct sessions saw activity in the last 30d
 *   - more than 3 distinct user-agent strings show up in those sessions
 *
 * On a flag, we refuse to run unless an operator has confirmed via:
 *   `tsx scripts/admin/confirm-multi-person-tag.ts <migrant-id>`
 *   → writes `data/global/.multi-person-tag-confirmed` (JSON)
 *
 * The marker is single-use: it is consumed (deleted) by `runMigration`
 * after the tag step, so a second migration run requires a fresh
 * confirmation.
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

import { getGlobalDir, isValidSlug } from './data-paths'

export const SESSION_COUNT_THRESHOLD = 20
export const UA_DIVERSITY_THRESHOLD = 3
export const ACTIVITY_WINDOW_DAYS = 30

export type LegacyGatewaySession = {
  id: string
  /** Last-active unix timestamp in seconds, like the Hermes-Gateway emits. */
  lastActiveSec?: number
  startedAtSec?: number
  userAgent?: string
  /** Source IP if the gateway tracks one. */
  ip?: string
}

export type MultiPersonAnalysis = {
  total: number
  inWindow: number
  uniqueUserAgents: number
  uniqueIps: number
  flagged: boolean
  reasons: Array<string>
}

/**
 * Run the heuristic against the legacy session list (typically the
 * result of `claude-api.listSessions` invoked once at migration time).
 * Pure function — no I/O, no side-effects.
 */
export function analyzeMultiPerson(sessions: ReadonlyArray<LegacyGatewaySession>): MultiPersonAnalysis {
  const cutoffSec = (Date.now() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000) / 1000
  const inWindowList = sessions.filter((s) => {
    const last = s.lastActiveSec ?? s.startedAtSec ?? 0
    return last >= cutoffSec
  })
  const userAgents = new Set<string>()
  const ips = new Set<string>()
  for (const s of inWindowList) {
    if (s.userAgent && s.userAgent.length > 0) userAgents.add(s.userAgent)
    if (s.ip && s.ip.length > 0) ips.add(s.ip)
  }
  const reasons: Array<string> = []
  if (inWindowList.length > SESSION_COUNT_THRESHOLD) {
    reasons.push(`${inWindowList.length} sessions in last ${ACTIVITY_WINDOW_DAYS}d (>${SESSION_COUNT_THRESHOLD})`)
  }
  if (userAgents.size > UA_DIVERSITY_THRESHOLD) {
    reasons.push(`${userAgents.size} distinct user-agents (>${UA_DIVERSITY_THRESHOLD})`)
  }
  return {
    total: sessions.length,
    inWindow: inWindowList.length,
    uniqueUserAgents: userAgents.size,
    uniqueIps: ips.size,
    flagged: reasons.length > 0,
    reasons,
  }
}

// ─── Confirmation marker (one-shot, consumed by runMigration) ──────────

const MARKER_FILE = '.multi-person-tag-confirmed'

export function multiPersonMarkerPath(): string {
  return join(getGlobalDir(), MARKER_FILE)
}

export type MultiPersonConfirmation = {
  confirmedAt: string
  migrantUserId: string
  confirmedBy: string
}

export function readMultiPersonConfirmation(): MultiPersonConfirmation | null {
  const path = multiPersonMarkerPath()
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (
      typeof raw?.confirmedAt === 'string'
      && typeof raw?.migrantUserId === 'string'
      && isValidSlug(raw.migrantUserId)
      && typeof raw?.confirmedBy === 'string'
    ) {
      return raw as MultiPersonConfirmation
    }
    return null
  } catch {
    return null
  }
}

export function isMultiPersonConfirmed(migrantUserId: string): boolean {
  const c = readMultiPersonConfirmation()
  if (!c) return false
  return c.migrantUserId === migrantUserId
}

export function consumeMultiPersonConfirmation(): boolean {
  const path = multiPersonMarkerPath()
  if (!existsSync(path)) return false
  try {
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}
