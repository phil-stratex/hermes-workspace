/**
 * Builder-Brief — formats one or more error entries as a Markdown
 * report ready to drop into a Builder chat.
 *
 * The killer-feature of the trouble-shooting center: instead of asking
 * Phil to retell what went wrong (and accidentally omitting the `userId`
 * or `requestId` the Builder needs), the UI lets him select 1..N error
 * entries and emit a self-contained briefing — IDs, redacted stack,
 * related logs in the same request, browser info, heuristic file
 * pointers — that pastes cleanly as one Markdown block.
 */

import type { ErrorEntry } from './error-types'
import { findRelatedByRequestId, getErrorById } from './error-store'

const FILE_FRAME_RE = /\bsrc[/\\][^\s)]+\.(?:ts|tsx|js|jsx)/g

function fmt(ts: string | undefined): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toISOString()
  } catch {
    return String(ts)
  }
}

function fileFromStack(stack: string | undefined): Array<string> {
  if (!stack) return []
  const set = new Set<string>()
  for (const m of stack.matchAll(FILE_FRAME_RE)) {
    set.add(m[0])
    if (set.size >= 5) break
  }
  return [...set]
}

function severityIcon(level: ErrorEntry['level']): string {
  switch (level) {
    case 'fatal':
      return '⛔'
    case 'error':
      return '❌'
    case 'warn':
      return '⚠️'
    case 'info':
      return 'ℹ️'
    case 'debug':
      return '🔍'
  }
}

export function formatErrorAsMarkdown(
  entry: ErrorEntry,
  related?: Array<ErrorEntry>,
): string {
  const lines: Array<string> = []
  lines.push(`# Error Report ${severityIcon(entry.level)}`)
  lines.push('')
  lines.push(`- **ID:** \`${entry.id}\``)
  lines.push(`- **When:** ${fmt(entry.ts)}`)
  if (entry.lastOccurrenceAt && (entry.occurrences ?? 1) > 1) {
    lines.push(`- **Last seen:** ${fmt(entry.lastOccurrenceAt)} (${entry.occurrences}× total)`)
  }
  lines.push(`- **Severity:** ${entry.level}`)
  lines.push(`- **Source:** ${entry.source}${entry.route ? ` (route \`${entry.route}\`)` : ''}`)
  if (entry.userId || entry.workspaceId) {
    const who: Array<string> = []
    if (entry.userId) who.push(`user \`${entry.userId}\``)
    if (entry.workspaceId) who.push(`workspace \`${entry.workspaceId}\``)
    lines.push(`- **Who:** ${who.join(' / ')}`)
  }
  if (entry.requestId) lines.push(`- **Request-ID:** \`${entry.requestId}\``)
  if (entry.method) lines.push(`- **Method:** ${entry.method}`)
  if (entry.ip) lines.push(`- **IP:** ${entry.ip}`)
  lines.push('')
  lines.push('## Message')
  lines.push('')
  lines.push('```')
  lines.push(entry.message)
  lines.push('```')

  if (entry.stack) {
    lines.push('')
    lines.push('## Stack (redacted)')
    lines.push('')
    lines.push('```')
    lines.push(entry.stack)
    lines.push('```')
  }

  if (entry.context && Object.keys(entry.context).length > 0) {
    lines.push('')
    lines.push('## Context')
    lines.push('')
    lines.push('```json')
    lines.push(JSON.stringify(entry.context, null, 2))
    lines.push('```')
  }

  if (entry.browser) {
    lines.push('')
    lines.push('## Browser')
    if (entry.browser.userAgent) lines.push(`- UA: \`${entry.browser.userAgent}\``)
    if (entry.browser.url) lines.push(`- URL: ${entry.browser.url}`)
    if (entry.browser.viewport) {
      lines.push(`- Viewport: ${entry.browser.viewport.width}×${entry.browser.viewport.height}`)
    }
  }

  if (related && related.length > 0) {
    lines.push('')
    lines.push(`## Related logs (same requestId, ±5s)`)
    lines.push('')
    for (const r of related) {
      const t = fmt(r.ts).slice(11, 23) // HH:MM:SS.mmm
      lines.push(`- ${t} **${r.level.toUpperCase()}** \`${r.source}\` — ${r.message}`)
    }
  }

  const files = fileFromStack(entry.stack)
  if (files.length > 0) {
    lines.push('')
    lines.push('## Files likely involved')
    lines.push('')
    for (const f of files) lines.push(`- \`${f}\``)
  }

  return lines.join('\n') + '\n'
}

export type ExportInput = {
  errorIds: ReadonlyArray<string>
  includeRelatedLogs?: boolean
}

export type ExportResult = {
  markdown: string
  count: number
  missing: Array<string>
}

/**
 * Format a multi-select export as one Markdown document with a header
 * summary plus per-error sections.
 */
export function formatErrorsAsMarkdown(input: ExportInput): ExportResult {
  const entries: Array<ErrorEntry> = []
  const missing: Array<string> = []
  for (const id of input.errorIds) {
    const e = getErrorById(id)
    if (e) entries.push(e)
    else missing.push(id)
  }

  if (entries.length === 0) {
    return { markdown: '_No matching error entries._\n', count: 0, missing }
  }

  // Summary
  const counts: Record<string, number> = {}
  let firstTs = entries[0].ts
  let lastTs = entries[0].ts
  for (const e of entries) {
    counts[e.level] = (counts[e.level] ?? 0) + 1
    if (e.ts < firstTs) firstTs = e.ts
    if (e.ts > lastTs) lastTs = e.ts
  }
  const sourceCounts: Record<string, number> = {}
  for (const e of entries) sourceCounts[e.source] = (sourceCounts[e.source] ?? 0) + 1
  const topSource = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0]?.[0]

  const lines: Array<string> = []
  lines.push(`# Error Briefing — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(
    `- **Counts:** ${Object.entries(counts)
      .map(([k, v]) => `${v}× ${k}`)
      .join(', ')}`,
  )
  lines.push(`- **Span:** ${fmt(firstTs)} → ${fmt(lastTs)}`)
  if (topSource) lines.push(`- **Top source:** \`${topSource}\``)

  const wsCounts = new Set<string>()
  const userCounts = new Set<string>()
  for (const e of entries) {
    if (e.workspaceId) wsCounts.add(e.workspaceId)
    if (e.userId) userCounts.add(e.userId)
  }
  if (wsCounts.size > 0) lines.push(`- **Workspaces:** ${[...wsCounts].join(', ')}`)
  if (userCounts.size > 0) lines.push(`- **Users:** ${[...userCounts].join(', ')}`)

  if (missing.length > 0) {
    lines.push('')
    lines.push(`> ⚠️ ${missing.length} requested ID(s) not found: ${missing.join(', ')}`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const e of entries) {
    const related = input.includeRelatedLogs && e.requestId
      ? findRelatedByRequestId(e.requestId)
      : undefined
    lines.push(formatErrorAsMarkdown(e, related))
    lines.push('---')
    lines.push('')
  }

  return { markdown: lines.join('\n'), count: entries.length, missing }
}
