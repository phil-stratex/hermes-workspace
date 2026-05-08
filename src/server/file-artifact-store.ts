import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { registerProjectFromArtifact } from './preview-projects-registry'

const DATA_DIR = join(process.cwd(), '.runtime', 'file-artifacts')
const INDEX_FILE = join(DATA_DIR, 'index.json')

export type FileArtifactKind = 'file_write' | 'file_edit' | 'file_create' | 'patch'

export type FileArtifact = {
  id: string
  sessionId: string
  messageId?: string
  toolCallId?: string
  toolName: string
  kind: FileArtifactKind
  path: string
  version: number
  contentSize: number
  contentPath: string
  contentHash: string
  diff?: string
  createdAt: number
}

type ArtifactIndex = {
  artifacts: Record<string, FileArtifact>
}

let index: ArtifactIndex = { artifacts: {} }

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function loadIndex(): void {
  try {
    if (!existsSync(INDEX_FILE)) return
    const parsed = JSON.parse(readFileSync(INDEX_FILE, 'utf-8')) as ArtifactIndex
    // Defensive: JSON.parse can return any shape on a corrupt index file.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (parsed && typeof parsed === 'object' && parsed.artifacts) {
      index = parsed
      return
    }
    // Parsed to a wrong shape — treat as corrupt and back up.
    try {
      const backupPath = `${INDEX_FILE}.corrupt-${Date.now()}`
      copyFileSync(INDEX_FILE, backupPath)
    } catch {
      // best-effort
    }
    index = { artifacts: {} }
  } catch {
    // Corrupt JSON. Back up the bad file before resetting in-memory state so
    // the next saveIndex() doesn't permanently overwrite the original.
    try {
      const backupPath = `${INDEX_FILE}.corrupt-${Date.now()}`
      copyFileSync(INDEX_FILE, backupPath)
    } catch {
      // best-effort
    }
    index = { artifacts: {} }
  }
}

// Atomic write: serialize to a sibling .tmp file, then rename. On *nix and
// modern Windows, rename within the same directory is atomic, so a torn
// write can never replace the live index.json.
function saveIndex(): void {
  ensureDataDir()
  const tmp = `${INDEX_FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(index, null, 2))
  renameSync(tmp, INDEX_FILE)
}

loadIndex()

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 200) || 'unknown'
}

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeWorkspacePath(rawPath: string): string | null {
  if (typeof rawPath !== 'string') return null
  const trimmed = rawPath.trim()
  if (!trimmed) return null
  if (trimmed.includes('\0')) return null
  // Strip leading slashes and Windows drive prefixes — workspace-relative only.
  let normalized = trimmed.replace(/\\/g, '/')
  normalized = normalized.replace(/^[a-zA-Z]:/, '')
  while (normalized.startsWith('/')) normalized = normalized.slice(1)
  if (!normalized) return null
  // Hard-reject anything that, post-normalization, still smells like an
  // absolute path or a windows drive prefix. Also reject any colon — the
  // metadata "path" field must never carry one.
  if (/^[a-zA-Z]:/.test(normalized)) return null
  if (normalized.includes(':')) return null
  if (normalized.startsWith('/') || normalized.startsWith('\\')) return null
  const segments = normalized.split('/')
  for (const segment of segments) {
    if (segment === '..' || segment === '.' || segment === '') return null
  }
  return segments.join('/')
}

function pathStorageSlug(path: string): string {
  const segments = path.split('/').map(sanitizePathSegment)
  return segments.join('__') || 'unknown'
}

function inferKindFromTool(toolName: string): FileArtifactKind {
  const lower = toolName.toLowerCase()
  if (lower.includes('patch')) return 'patch'
  if (lower.includes('create')) return 'file_create'
  if (lower.includes('edit') || lower.includes('replace') || lower.includes('multi_edit')) {
    return 'file_edit'
  }
  return 'file_write'
}

function getNextVersion(sessionId: string, path: string): number {
  let max = 0
  for (const artifact of Object.values(index.artifacts)) {
    if (artifact.sessionId === sessionId && artifact.path === path) {
      if (artifact.version > max) max = artifact.version
    }
  }
  return max + 1
}

// Per-(sessionId, path) async mutex. Two concurrent createFileArtifact calls
// for the same key would otherwise both read the same max version and emit
// duplicate IDs / overwrite each other's content files. The mutex serializes
// the version-pick + write so each call increments the counter cleanly.
const versionLocks = new Map<string, Promise<unknown>>()

async function withVersionLock<T>(
  sessionId: string,
  path: string,
  fn: () => T,
): Promise<T> {
  const key = `${sessionId}::${path}`
  const previous = versionLocks.get(key) ?? Promise.resolve()
  let release: () => void = () => {}
  const next = new Promise<void>((resolve) => {
    release = resolve
  })
  versionLocks.set(
    key,
    previous.then(() => next),
  )
  try {
    await previous
    return fn()
  } finally {
    release()
    if (versionLocks.get(key) === next) {
      versionLocks.delete(key)
    }
  }
}

function splitLines(value: string): Array<string> {
  if (!value) return []
  return value.replace(/\r\n/g, '\n').split('\n')
}

// Minimal LCS-based unified diff. Not perfect (no rolling hunks, single block
// per change region), but good enough for display in the preview panel.
function makeUnifiedDiff(
  oldContent: string,
  newContent: string,
  path: string,
): string | undefined {
  const oldLines = splitLines(oldContent)
  const newLines = splitLines(newContent)
  const oldLen = oldLines.length
  const newLen = newLines.length

  // Cap LCS at 1500x1500. Above this we return `undefined`; the DiffView
  // already falls back to fetching the previous version and computing the
  // diff client-side via Monaco. Memory at the cap with Uint16Array is
  // ~4.5 MB instead of ~128 MB at the previous 4000x4000 / number-array
  // implementation.
  const limit = 1500
  if (oldLen > limit || newLen > limit) return undefined

  // Flat Uint16Array DP; index (i*W + j). Values bounded by max(oldLen,newLen)
  // <= 1500 which fits comfortably in 16-bit.
  const width = newLen + 1
  const dp = new Uint16Array((oldLen + 1) * width)
  for (let i = oldLen - 1; i >= 0; i--) {
    for (let j = newLen - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i * width + j] = dp[(i + 1) * width + (j + 1)] + 1
      } else {
        const a = dp[(i + 1) * width + j]
        const b = dp[i * width + (j + 1)]
        dp[i * width + j] = a >= b ? a : b
      }
    }
  }

  type Op = { kind: ' ' | '-' | '+'; oldLine: number; newLine: number; text: string }
  const ops: Array<Op> = []
  let i = 0
  let j = 0
  while (i < oldLen && j < newLen) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ kind: ' ', oldLine: i + 1, newLine: j + 1, text: oldLines[i] })
      i++
      j++
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      ops.push({ kind: '-', oldLine: i + 1, newLine: j, text: oldLines[i] })
      i++
    } else {
      ops.push({ kind: '+', oldLine: i, newLine: j + 1, text: newLines[j] })
      j++
    }
  }
  while (i < oldLen) {
    ops.push({ kind: '-', oldLine: i + 1, newLine: j, text: oldLines[i] })
    i++
  }
  while (j < newLen) {
    ops.push({ kind: '+', oldLine: i, newLine: j + 1, text: newLines[j] })
    j++
  }

  // If everything matches, no diff body — return empty.
  if (!ops.some((op) => op.kind !== ' ')) return ''

  const header = `--- a/${path}\n+++ b/${path}\n`
  // Single hunk covering the whole file; keep simple.
  const oldStart = oldLen === 0 ? 0 : 1
  const newStart = newLen === 0 ? 0 : 1
  const hunkHeader = `@@ -${oldStart},${oldLen} +${newStart},${newLen} @@\n`
  const body = ops.map((op) => `${op.kind}${op.text}`).join('\n')
  return `${header}${hunkHeader}${body}`
}

type CreateFileArtifactInput = {
  sessionId: string
  messageId?: string
  toolCallId?: string
  toolName: string
  kind?: FileArtifactKind
  path: string
  content: string
  previousContent?: string
}

export async function createFileArtifact(
  input: CreateFileArtifactInput,
): Promise<FileArtifact | null> {
  const sanitizedPath = normalizeWorkspacePath(input.path)
  if (!sanitizedPath) {
    // Treat invalid paths as "skip" rather than throwing — callers wrap us in
    // try/catch already, but a return-null contract avoids noisy stack traces
    // in the SSE pipeline for paths that simply aren't capturable.
    return null
  }
  const sessionId = input.sessionId.trim()
  if (!sessionId) {
    throw new Error('sessionId required')
  }

  return withVersionLock(sessionId, sanitizedPath, () => {
    const contentHash = hashString(input.content)

    // Server-side dedup — if an artifact already exists for the same
    // (sessionId, toolCallId, contentHash), return it instead of creating a
    // duplicate. The poller and the run-completion backfill can both fire for
    // the same tool-call, and without this check we end up writing v1+v2 with
    // identical content.
    if (input.toolCallId) {
      for (const existing of Object.values(index.artifacts)) {
        if (existing.sessionId !== sessionId) continue
        if (existing.toolCallId !== input.toolCallId) continue
        if (existing.contentHash !== contentHash) continue
        // Match — skip the write, return the existing record.
        console.log(
          '[file-artifact-store] dedup hit',
          existing.id,
          'session=',
          sessionId,
          'tool=',
          input.toolCallId,
        )
        return existing
      }
    }

    const version = getNextVersion(sessionId, sanitizedPath)
    const stableKey = [sessionId, sanitizedPath, String(version)].join('\n')
    const id = `file_${hashString(stableKey).slice(0, 16)}_v${version}`
    const kind = input.kind ?? inferKindFromTool(input.toolName)
    const sessionDir = join(DATA_DIR, sanitizePathSegment(sessionId))
    const slug = pathStorageSlug(sanitizedPath)
    const contentPath = join(sessionDir, `${slug}__v${version}.json`)

    const diff =
      typeof input.previousContent === 'string'
        ? makeUnifiedDiff(input.previousContent, input.content, sanitizedPath)
        : undefined

    const artifact: FileArtifact = {
      id,
      sessionId,
      messageId: input.messageId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      kind,
      path: sanitizedPath,
      version,
      contentSize: input.content.length,
      contentPath,
      contentHash,
      diff: diff && diff.length > 0 ? diff : undefined,
      createdAt: Date.now(),
    }

    if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true })
    // Atomic content write — same scheme as saveIndex(). Avoids leaving a
    // half-written file behind if the process crashes mid-write.
    const tmpPath = `${contentPath}.tmp`
    writeFileSync(
      tmpPath,
      JSON.stringify(
        {
          artifact: { ...artifact, contentPath: undefined },
          content: input.content,
        },
        null,
        2,
      ),
    )
    renameSync(tmpPath, contentPath)
    index.artifacts[id] = artifact
    saveIndex()
    // Best-effort: if this artifact is a `package.json`, register the
    // surrounding project in the preview-projects registry so the
    // frontend can offer a "Run Project" button. Wrapped so a failure
    // here never masks a successful artifact write.
    try {
      registerProjectFromArtifact({
        sessionId,
        path: sanitizedPath,
      })
    } catch {
      // best-effort
    }
    return artifact
  })
}

type ListFilter = {
  sessionId?: string
  path?: string
}

export function listFileArtifacts(filter?: ListFilter): Array<FileArtifact> {
  const sessionId = filter?.sessionId?.trim()
  const path =
    filter?.path !== undefined ? normalizeWorkspacePath(filter.path) : undefined
  return Object.values(index.artifacts)
    .filter((artifact) => {
      if (sessionId && artifact.sessionId !== sessionId) return false
      if (path && artifact.path !== path) return false
      return true
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function getFileArtifact(
  artifactId: string,
): (FileArtifact & { content: string }) | null {
  const artifact = index.artifacts[artifactId]
  // Defensive: Record indexing types as defined, but lookup of unknown id returns undefined.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!artifact) return null
  try {
    const raw = readFileSync(artifact.contentPath, 'utf-8')
    const parsed = JSON.parse(raw) as { content?: unknown }
    return {
      ...artifact,
      content: typeof parsed.content === 'string' ? parsed.content : '',
    }
  } catch {
    return { ...artifact, content: '' }
  }
}

export function getLatestVersion(
  sessionId: string,
  path: string,
): FileArtifact | null {
  const normalizedPath = normalizeWorkspacePath(path)
  if (!normalizedPath) return null
  let latest: FileArtifact | null = null
  for (const artifact of Object.values(index.artifacts)) {
    if (artifact.sessionId !== sessionId) continue
    if (artifact.path !== normalizedPath) continue
    if (!latest || artifact.version > latest.version) latest = artifact
  }
  return latest
}
