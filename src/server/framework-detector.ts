/**
 * Framework detector.
 *
 * Pure function: given an absolute project directory, inspect
 * `package.json` (or fall back to `index.html` for static sites) and
 * return the framework, dev command, default port, and whether the
 * framework supports a sub-path base (so the workspace proxy can mount
 * the dev-server at `/preview/<runId>/`).
 *
 * Returns `null` if the directory doesn't exist or has no recognisable
 * project marker.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type DetectedFramework = {
  framework:
    | 'next'
    | 'vite'
    | 'astro'
    | 'sveltekit'
    | 'cra'
    | 'static'
    | 'unknown'
  devCommand: string
  defaultPort: number
  /** Whether the framework can be told to serve from a sub-path. */
  basePathSupported: boolean
  /**
   * CLI flag for sub-path injection (vite: `--base`). `null` when the
   * mechanism is config-file-based (next basePath) or unsupported.
   */
  basePathFlag: string | null
}

type PackageJsonShape = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

function readPackageJson(projectDir: string): PackageJsonShape | null {
  const pkgPath = join(projectDir, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    const raw = readFileSync(pkgPath, 'utf8')
    const parsed = JSON.parse(raw) as PackageJsonShape
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive: disk could hold null/array/primitive
    if (parsed && typeof parsed === 'object') return parsed
    return null
  } catch {
    return null
  }
}

function hasDep(pkg: PackageJsonShape, name: string): boolean {
  if (pkg.dependencies && name in pkg.dependencies) return true
  if (pkg.devDependencies && name in pkg.devDependencies) return true
  return false
}

export function detectFramework(
  projectDir: string,
): DetectedFramework | null {
  if (!existsSync(projectDir)) return null

  const pkg = readPackageJson(projectDir)

  if (!pkg) {
    // No package.json — static site fallback if there's an index.html.
    const indexHtml = join(projectDir, 'index.html')
    if (existsSync(indexHtml)) {
      return {
        framework: 'static',
        devCommand: 'python3 -m http.server',
        defaultPort: 8000,
        basePathSupported: false,
        basePathFlag: null,
      }
    }
    return null
  }

  if (hasDep(pkg, 'next')) {
    return {
      framework: 'next',
      devCommand: 'pnpm dev',
      defaultPort: 3000,
      basePathSupported: true,
      // Next reads basePath from `next.config.*` (or NEXT_BASE_PATH env).
      basePathFlag: null,
    }
  }
  if (hasDep(pkg, 'vite')) {
    return {
      framework: 'vite',
      devCommand: 'pnpm dev',
      defaultPort: 5173,
      basePathSupported: true,
      basePathFlag: '--base',
    }
  }
  if (hasDep(pkg, 'astro')) {
    return {
      framework: 'astro',
      devCommand: 'pnpm dev',
      defaultPort: 4321,
      basePathSupported: false,
      basePathFlag: null,
    }
  }
  if (hasDep(pkg, '@sveltejs/kit')) {
    return {
      framework: 'sveltekit',
      devCommand: 'pnpm dev',
      defaultPort: 5173,
      basePathSupported: false,
      basePathFlag: null,
    }
  }
  if (hasDep(pkg, 'react-scripts')) {
    return {
      framework: 'cra',
      devCommand: 'pnpm start',
      defaultPort: 3000,
      basePathSupported: false,
      basePathFlag: null,
    }
  }

  // Heuristic fallback — anything with a `dev` script we'll attempt as
  // vite-like (most starter templates fit this shape).
  if (pkg.scripts && typeof pkg.scripts.dev === 'string') {
    return {
      framework: 'unknown',
      devCommand: 'pnpm dev',
      defaultPort: 3000,
      basePathSupported: false,
      basePathFlag: null,
    }
  }

  return {
    framework: 'unknown',
    devCommand: 'pnpm dev',
    defaultPort: 3000,
    basePathSupported: false,
    basePathFlag: null,
  }
}

/**
 * Workspace base directory inside the hermes-agent container — kept here
 * so callers don't have to repeat the env-var fallback, but path joining
 * stays the caller's responsibility.
 */
export const HERMES_WORKSPACE_DIR =
  process.env.HERMES_WORKSPACE_DIR || '/opt/data/workspace'
