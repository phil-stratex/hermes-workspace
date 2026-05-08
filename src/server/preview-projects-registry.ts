/**
 * Preview projects registry.
 *
 * Tracks projects that the Hermes agent has scaffolded — keyed off the
 * `package.json` writes intercepted by the file-artifact-store. The
 * registry is purely an index for the frontend to render a "Run Project"
 * affordance; nothing here actually starts the dev server.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { writeJsonAtomic } from './atomic-write'
import {
  
  HERMES_WORKSPACE_DIR,
  detectFramework
} from './framework-detector'
import type {DetectedFramework} from './framework-detector';

const STATE_FILE = join(process.cwd(), '.runtime', 'preview-projects.json')

export type RegisteredProject = {
  id: string
  sessionId: string
  projectDirRelative: string
  framework: DetectedFramework['framework']
  registeredAt: number
}

type RegistryFile = {
  projects: Record<string, RegisteredProject>
}

const registry = new Map<string, RegisteredProject>()

function ensureStateDir(): void {
  const dir = dirname(STATE_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function loadState(): void {
  try {
    if (!existsSync(STATE_FILE)) return
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as RegistryFile
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive: disk could hold null/array/primitive
    if (parsed && typeof parsed === 'object' && parsed.projects) {
      for (const [id, project] of Object.entries(parsed.projects)) {
        registry.set(id, project)
      }
    }
  } catch {
    // Corrupt state — start fresh.
  }
}

function persistState(): void {
  ensureStateDir()
  const obj: RegistryFile = { projects: {} }
  for (const [id, project] of registry) {
    obj.projects[id] = project
  }
  try {
    writeJsonAtomic(STATE_FILE, obj)
  } catch {
    // Non-fatal — in-memory map remains authoritative.
  }
}

loadState()

function basename(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx >= 0 ? path.slice(idx + 1) : path
}

function dirnameRelative(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx >= 0 ? path.slice(0, idx) : ''
}

function hashId(sessionId: string, projectDirRelative: string): string {
  return createHash('sha256')
    .update(`${sessionId}::${projectDirRelative}`)
    .digest('hex')
    .slice(0, 16)
}

type RegisterInput = {
  sessionId: string
  path: string
}

export function registerProjectFromArtifact(
  input: RegisterInput,
): RegisteredProject | null {
  if (!input.sessionId || !input.path) return null
  if (basename(input.path) !== 'package.json') return null

  const projectDirRelative = dirnameRelative(input.path)
  // package.json at workspace root — register with empty dir so the
  // frontend treats the workspace itself as a runnable project.
  const id = hashId(input.sessionId, projectDirRelative)

  const absoluteProjectDir = projectDirRelative
    ? `${HERMES_WORKSPACE_DIR}/${projectDirRelative}`
    : HERMES_WORKSPACE_DIR
  const detected = detectFramework(absoluteProjectDir)

  const project: RegisteredProject = {
    id,
    sessionId: input.sessionId,
    projectDirRelative,
    framework: detected?.framework ?? 'unknown',
    registeredAt: Date.now(),
  }

  registry.set(id, project)
  persistState()
  return project
}

export function listRegisteredProjects(
  sessionId?: string,
): Array<RegisteredProject> {
  const all = Array.from(registry.values())
  const filtered = sessionId
    ? all.filter((p) => p.sessionId === sessionId)
    : all
  return filtered.sort((a, b) => b.registeredAt - a.registeredAt)
}
