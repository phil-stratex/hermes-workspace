#!/usr/bin/env node
/**
 * Phase A.8 — Route Refactor Batch.
 *
 * Replaces the 3-line legacy auth pattern with the new helper from
 * `route-auth-helpers.ts`, per a route → action mapping. Only touches
 * routes explicitly listed in Plan A.3.1 + a few obvious workspace-
 * scoped neighbours; the other ~95 files keep using the deprecated
 * `isAuthenticated` wrapper for now.
 *
 * Run from repo root: `node scripts/dev/a8-route-refactor.mjs`
 *
 * Idempotent — re-running on already-refactored files is a no-op.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

/** Route → action mapping. `null` action = `requireAuthenticated`. */
const PLAN_ROUTES = [
  // workspace-action gated
  ['src/routes/api/council.ts',                  'chat'],
  ['src/routes/api/switch-model.ts',             'roster-edit'],
  ['src/routes/api/swarm-tmux-start.ts',         'worker-control'],
  ['src/routes/api/swarm-tmux-stop.ts',          'worker-control'],
  ['src/routes/api/swarm-decompose.ts',          'chat'],
  ['src/routes/api/swarm-dispatch.ts',           'chat'],
  ['src/routes/api/swarm-orchestrator-loop.ts',  'chat'],
  ['src/routes/api/swarm-direct-chat.ts',        'chat'],
  // active-member gated (no specific action — every member can do it)
  ['src/routes/api/swarm-idle-tick.ts',          '__member__'],
  ['src/routes/api/workspace.ts',                '__member__'],
  // global-but-authenticated
  ['src/routes/api/system-info.ts',              null],
]

// Two pattern variants seen across the legacy routes:
//   { ok: false, error: 'Unauthorized' }   (sessions.ts style)
//   { error: 'Unauthorized' }              (swarm-* style)
const LEGACY_PATTERNS = [
  /if \(!isAuthenticated\(request\)\) \{\s*return json\(\{\s*ok:\s*false,\s*error:\s*['"]Unauthorized['"]\s*\},\s*\{\s*status:\s*401\s*\}\)\s*\}/g,
  /if \(!isAuthenticated\(request\)\) \{\s*return json\(\{\s*error:\s*['"]Unauthorized['"]\s*\},\s*\{\s*status:\s*401\s*\}\)\s*\}/g,
]

let totalReplacements = 0
const summary = []

for (const [relPath, action] of PLAN_ROUTES) {
  const path = join(repoRoot, relPath)
  let src
  try {
    src = readFileSync(path, 'utf8')
  } catch (err) {
    summary.push({ relPath, action, status: 'missing', count: 0, message: err.message })
    continue
  }

  const before = src

  // Determine helper invocation per file action.
  const helperCall = action === null
    ? `const auth = requireAuthenticated(request)\n        if (!auth.ok) return auth.response`
    : action === '__member__'
      ? `const auth = requireActiveWorkspaceMember(request)\n        if (!auth.ok) return auth.response`
      : `const guard = requireWorkspaceAction(request, '${action}')\n        if (!guard.ok) return guard.response`

  // Patch import line.
  const helperImports = []
  if (action === null) helperImports.push('requireAuthenticated')
  else if (action === '__member__') helperImports.push('requireActiveWorkspaceMember')
  else helperImports.push('requireWorkspaceAction')

  // Replace `import { isAuthenticated } from '../../server/auth-middleware'`
  if (src.includes('isAuthenticated') && !src.includes('route-auth-helpers')) {
    // Drop isAuthenticated from the existing import; add the new helper import.
    src = src.replace(
      /import \{\s*([^}]*)\bisAuthenticated\b\s*,?\s*([^}]*)\}\s*from\s*'\.\.\/\.\.\/server\/auth-middleware'/,
      (_match, before2, after) => {
        const remaining = (before2 + after)
          .replace(/,\s*,/g, ', ')
          .replace(/^\s*,\s*/, '')
          .replace(/\s*,\s*$/, '')
          .trim()
        return remaining.length > 0
          ? `import { ${remaining} } from '../../server/auth-middleware'`
          : `// (auth-middleware import dropped — uses route-auth-helpers below)`
      },
    )
    // Add the new helper import after the json import line as a stable anchor.
    if (src.includes("from '@tanstack/react-start'")) {
      src = src.replace(
        /(from '@tanstack\/react-start'\n)/,
        `$1import { ${helperImports.join(', ')} } from '../../server/route-auth-helpers'\n`,
      )
    }
  }

  let count = 0
  for (const pattern of LEGACY_PATTERNS) {
    src = src.replace(pattern, () => {
      count++
      return helperCall
    })
  }

  if (src !== before) {
    writeFileSync(path, src, 'utf8')
    totalReplacements += count
    summary.push({ relPath, action, status: 'patched', count })
  } else {
    summary.push({ relPath, action, status: 'noop', count: 0 })
  }
}

console.log('───────────── Phase A.8 — Route Refactor ─────────────')
console.log(`Files considered: ${PLAN_ROUTES.length}`)
console.log(`Total auth-pattern replacements: ${totalReplacements}`)
console.log()
for (const s of summary) {
  const marker = s.status === 'patched' ? '✓' : s.status === 'missing' ? '✗' : '·'
  const action = s.action === null ? 'req-auth' : s.action === '__member__' ? 'req-member' : `req-action:${s.action}`
  console.log(`${marker}  [${s.status.padEnd(7)}] ${s.relPath.padEnd(56)}  → ${action}  (${s.count} hits)`)
  if (s.message) console.log(`    ${s.message}`)
}
console.log()
console.log(`Note: sessions.ts + send-stream.ts are refactored manually with`)
console.log(`      filterVisibleSessions() and tagSession() — they're not in this batch.`)
