#!/usr/bin/env node
/**
 * Phase A.8 follow-up — Fix missing route-auth-helpers imports.
 *
 * The first refactor pass added the helper *call* in some files but
 * skipped the import line because the original `isAuthenticated`
 * import had already been dropped before the second pattern matched.
 * This script walks every route file under `src/routes/api/`, detects
 * which helpers it actually calls, and inserts the missing imports.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')
const apiRoot = join(repoRoot, 'src', 'routes', 'api')

function* walkTsFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) yield* walkTsFiles(fullPath)
    else if (entry.isFile() && entry.name.endsWith('.ts')) yield fullPath
  }
}

let patchedFiles = 0

for (const path of walkTsFiles(apiRoot)) {
  let src = readFileSync(path, 'utf8')
  const before = src

  const usesAction = /\brequireWorkspaceAction\s*\(/.test(src)
  const usesMember = /\brequireActiveWorkspaceMember\s*\(/.test(src)
  const usesAuth = /\brequireAuthenticated\s*\(/.test(src)
  const hasImport = /from\s+['"]\.\.\/\.\.\/server\/route-auth-helpers['"]/.test(src)

  if (!(usesAction || usesMember || usesAuth)) continue
  if (hasImport) continue

  const helpers = []
  if (usesAuth) helpers.push('requireAuthenticated')
  if (usesAction) helpers.push('requireWorkspaceAction')
  if (usesMember) helpers.push('requireActiveWorkspaceMember')

  const importLine = `import { ${helpers.join(', ')} } from '../../server/route-auth-helpers'\n`

  // Insert after the @tanstack/react-start import if present, else after
  // the first import line.
  if (/from '@tanstack\/react-start'\r?\n/.test(src)) {
    src = src.replace(/(from '@tanstack\/react-start'\r?\n)/, `$1${importLine}`)
  } else if (/^import.*\r?\n/m.test(src)) {
    src = src.replace(/^(import.*\r?\n)/m, `$1${importLine}`)
  }

  if (src !== before) {
    writeFileSync(path, src, 'utf8')
    patchedFiles++
    console.log(`✓ patched ${path.replace(repoRoot, '')}: + ${helpers.join(', ')}`)
  }
}

console.log()
console.log(`Files patched: ${patchedFiles}`)
