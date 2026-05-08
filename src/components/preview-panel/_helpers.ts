const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps1: 'powershell',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  markdown: 'markdown',
  sql: 'sql',
  dockerfile: 'docker',
  vue: 'vue',
  svelte: 'svelte',
  graphql: 'graphql',
  gql: 'graphql',
}

/**
 * Map a path's extension to a Shiki / Monaco-compatible language id.
 * Falls back to `text` when nothing matches.
 */
export function getLanguageFromPath(path: string): string {
  if (!path) return 'text'
  const lower = path.toLowerCase()
  const lastSlash = Math.max(lower.lastIndexOf('/'), lower.lastIndexOf('\\'))
  const filename = lastSlash >= 0 ? lower.slice(lastSlash + 1) : lower
  if (filename === 'dockerfile' || filename.endsWith('.dockerfile')) {
    return 'docker'
  }
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return 'text'
  const ext = filename.slice(dot + 1)
  return LANGUAGE_BY_EXTENSION[ext] ?? 'text'
}

/**
 * Extract the file basename from a unix or windows path.
 */
export function getBasename(path: string): string {
  if (!path) return ''
  const trimmed = path.replace(/[\\/]+$/, '')
  const lastSlash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed
}

/**
 * Extract the directory portion of a unix or windows path.
 * Returns '' when the path has no separator (i.e. it's already a basename).
 */
export function getDirname(path: string): string {
  if (!path) return ''
  const trimmed = path.replace(/[\\/]+$/, '')
  const lastSlash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return lastSlash >= 0 ? trimmed.slice(0, lastSlash) : ''
}

const KIND_LABELS: Record<string, string> = {
  file_write: 'Write',
  file_edit: 'Edit',
  file_create: 'Create',
  patch: 'Patch',
}

/**
 * Friendly label for the FileArtifact `kind` field.
 */
export function getKindLabel(kind?: string): string {
  if (!kind) return 'Artifact'
  return KIND_LABELS[kind] ?? kind
}

/**
 * Color tokens for the artifact-kind badge / card border.
 * Returns Tailwind class fragments; a component composes them as needed.
 */
export function getKindAccent(kind?: string): {
  border: string
  text: string
  bg: string
} {
  switch (kind) {
    case 'file_write':
      return {
        border: 'border-blue-300 dark:border-blue-700',
        text: 'text-blue-700 dark:text-blue-300',
        bg: 'bg-blue-50 dark:bg-blue-950/30',
      }
    case 'file_edit':
      return {
        border: 'border-amber-300 dark:border-amber-700',
        text: 'text-amber-700 dark:text-amber-300',
        bg: 'bg-amber-50 dark:bg-amber-950/30',
      }
    case 'file_create':
      return {
        border: 'border-emerald-300 dark:border-emerald-700',
        text: 'text-emerald-700 dark:text-emerald-300',
        bg: 'bg-emerald-50 dark:bg-emerald-950/30',
      }
    case 'patch':
      return {
        border: 'border-purple-300 dark:border-purple-700',
        text: 'text-purple-700 dark:text-purple-300',
        bg: 'bg-purple-50 dark:bg-purple-950/30',
      }
    default:
      return {
        border: 'border-primary-200',
        text: 'text-primary-700',
        bg: 'bg-primary-50',
      }
  }
}

/**
 * Human-readable relative timestamp for history rows.
 */
export function formatRelativeTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  const diff = Date.now() - timestamp
  if (diff < 0) return 'just now'
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

/**
 * Human-readable file size.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/**
 * Returns true when the path looks like markdown.
 */
export function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown')
}

/**
 * Returns true when the path looks like HTML.
 */
export function isHtmlPath(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith('.html') || lower.endsWith('.htm')
}

/**
 * Shape of a file artifact returned by the workspace API.
 * Mirrors the backend contract; kept colocated so consumers don't need to
 * import from a server module that may not exist yet.
 */
export type FileArtifact = {
  id: string
  sessionId: string
  toolCallId?: string
  toolName: string
  kind: 'file_write' | 'file_edit' | 'file_create' | 'patch'
  path: string
  version: number
  contentSize: number
  diff?: string
  createdAt: number
}

export type FileArtifactWithContent = FileArtifact & {
  content: string
}
