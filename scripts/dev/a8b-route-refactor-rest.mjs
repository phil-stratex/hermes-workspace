#!/usr/bin/env node
/**
 * Phase A.8b — Mass-Refactor of every remaining route still using
 * the deprecated `isAuthenticated()` helper.
 *
 * Plan A.3.1 only listed ~15 explicit workspace-scoped routes (those
 * are already done in Phase A.8). The other ~95 routes use the
 * legacy helper for plain-old authenticated-only access checks; this
 * pass migrates them all to `requireAuthenticated` from
 * `route-auth-helpers.ts` so the deprecated wrapper can eventually
 * be deleted.
 *
 * Idempotent. Safe-default semantics: every replacement maps to
 * `requireAuthenticated` (no action gate). Routes that need a
 * specific permission must be hand-tuned afterwards.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')
const apiRoot = join(repoRoot, 'src', 'routes', 'api')

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(fullPath)
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
      yield fullPath
    }
  }
}

const PATTERNS = [
  /if \(!isAuthenticated\(request\)\) \{\s*return json\(\{\s*ok:\s*false,\s*error:\s*['"]Unauthorized['"]\s*\},\s*\{\s*status:\s*401\s*\}\)\s*\}/g,
  /if \(!isAuthenticated\(request\)\) \{\s*return json\(\{\s*error:\s*['"]Unauthorized['"]\s*\},\s*\{\s*status:\s*401\s*\}\)\s*\}/g,
]

const REPLACEMENT = `const auth = requireAuthenticated(request)\n        if (!auth.ok) return auth.response`

let totalReplacements = 0
let filesPatched = 0
const filesSkipped = []

for (const path of walk(apiRoot)) {
  let src = readFileSync(path, 'utf8')
  const before = src

  if (!src.includes('isAuthenticated(request)')) continue

  // Compute relative path for nesting (e.g. mcp/configure.ts → 3 levels up)
  const rel = path.replace(repoRoot + '\\', '').replace(repoRoot + '/', '')
  const segments = rel.replace(/\\/g, '/').split('/').slice(2) // strip "src/routes"
  const depth = segments.length
  // depth 1 = src/routes/api/foo.ts → ../../server/...
  // depth 2 = src/routes/api/foo/bar.ts → ../../../server/...
  const importPath = '../'.repeat(depth) + 'server/route-auth-helpers'

  let count = 0
  for (const p of PATTERNS) {
    src = src.replace(p, () => {
      count++
      return REPLACEMENT
    })
  }

  if (count === 0) {
    // Pattern didn't match — file uses isAuthenticated in a custom way.
    filesSkipped.push({ rel, reason: 'pattern-mismatch' })
    continue
  }

  // Replace the import. Drop `isAuthenticated` from the existing
  // auth-middleware import (preserve any other named imports).
  src = src.replace(
    /import \{\s*([^}]*?)\bisAuthenticated\b\s*,?\s*([^}]*?)\}\s*from\s*['"][^'"]*\/auth-middleware['"]/,
    (_match, before2, after) => {
      const remaining = (before2 + after)
        .replace(/,\s*,/g, ', ')
        .replace(/^\s*,\s*/, '')
        .replace(/\s*,\s*$/, '')
        .trim()
      return remaining.length > 0
        ? `import { ${remaining} } from '${'../'.repeat(depth)}server/auth-middleware'`
        : `// (auth-middleware import dropped — uses route-auth-helpers below)`
    },
  )

  // Insert the new helper import (CRLF-aware).
  if (!new RegExp(`from ['"]${importPath.replace(/\//g, '\\/').replace(/\./g, '\\.')}['"]`).test(src)) {
    if (/from '@tanstack\/react-start'\r?\n/.test(src)) {
      src = src.replace(
        /(from '@tanstack\/react-start'\r?\n)/,
        `$1import { requireAuthenticated } from '${importPath}'\n`,
      )
    } else if (/^import.*\r?\n/m.test(src)) {
      src = src.replace(
        /^(import.*\r?\n)/m,
        `$1import { requireAuthenticated } from '${importPath}'\n`,
      )
    }
  }

  if (src !== before) {
    writeFileSync(path, src, 'utf8')
    filesPatched++
    totalReplacements += count
  }
}

console.log('───── Phase A.8b — Mass-Refactor ─────')
console.log(`Files patched: ${filesPatched}`)
console.log(`Total auth-pattern replacements: ${totalReplacements}`)
console.log(`Files skipped (pattern mismatch): ${filesSkipped.length}`)
if (filesSkipped.length > 0 && filesSkipped.length <= 20) {
  for (const s of filesSkipped) console.log(`  · ${s.rel}  → ${s.reason}`)
}
