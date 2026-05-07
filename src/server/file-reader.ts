/**
 * File-Reader — extracts usable text from a chat/council/swarm attachment.
 *
 * Inputs come from the browser as `dataUrl` (base64) plus mime + name. We
 * decode and dispatch by mime:
 *
 *  - text/* | application/json | application/x-yaml — decoded as UTF-8
 *  - common code mime types (typescript, python, etc.) — UTF-8
 *  - application/pdf — extracted via PyMuPDF in the hermes-agent container
 *    (`docker exec` bridge). Requires `pymupdf` installed there.
 *  - image/* — passed through as-is for multimodal models
 *  - everything else — best-effort UTF-8 with replacement char
 *
 * Returns either:
 *  - { kind: 'text', text, name, contentType, truncated, originalSize }
 *  - { kind: 'image', dataUrl, name, contentType }
 *  - { kind: 'unsupported', name, contentType, hint }
 *
 * Hard limit: 200KB extracted text. Larger gets truncated with a marker.
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { swarmExec, useDockerExec } from './swarm-docker-exec'

const MAX_TEXT_BYTES = 200 * 1024
const TEXT_MIME_PREFIXES = ['text/']
const TEXT_MIME_EXACT = new Set([
  'application/json',
  'application/x-yaml',
  'application/yaml',
  'application/javascript',
  'application/typescript',
  'application/x-typescript',
  'application/x-python',
  'application/xml',
  'application/x-sh',
  'application/x-shellscript',
  'application/x-toml',
])
const TEXT_EXT_FALLBACK = new Set([
  '.txt', '.md', '.markdown', '.rst', '.csv', '.tsv',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs',
  '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.sh', '.bash', '.zsh', '.fish', '.ps1',
  '.html', '.css', '.scss', '.sass', '.less', '.svg',
  '.xml', '.sql', '.graphql', '.proto', '.dockerfile',
  '.env', '.gitignore', '.editorconfig',
])

export type RawAttachment = {
  name?: string
  contentType?: string
  dataUrl?: string
  base64?: string
  size?: number
}

export type ExtractedText = {
  kind: 'text'
  name: string
  contentType: string
  text: string
  truncated: boolean
  originalSize: number
}

export type ExtractedImage = {
  kind: 'image'
  name: string
  contentType: string
  dataUrl: string
}

export type Unsupported = {
  kind: 'unsupported'
  name: string
  contentType: string
  hint: string
}

export type ExtractionResult = ExtractedText | ExtractedImage | Unsupported

function getExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx).toLowerCase() : ''
}

function decodeBase64(dataUrl: string): Buffer {
  if (!dataUrl.startsWith('data:')) {
    // legacy chat-composer format: text files arrive as raw UTF-8 in dataUrl
    return Buffer.from(dataUrl, 'utf-8')
  }
  const comma = dataUrl.indexOf(',')
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  return Buffer.from(b64, 'base64')
}

async function extractPdfTextViaDockerExec(buf: Buffer): Promise<{
  ok: boolean
  text: string
  truncated: boolean
  originalSize: number
  error?: string
}> {
  if (!useDockerExec()) {
    return {
      ok: false,
      text: '',
      truncated: false,
      originalSize: buf.length,
      error: 'PDF extraction requires HERMES_VPS_CONTAINER (docker-exec mode).',
    }
  }
  // Files land in the shared /opt/data volume so the hermes-agent
  // container can read them at the same path. Workspace-container has
  // HERMES_HOME=/opt/data which makes this resolve identically.
  const tmpDir = path.join(
    process.env.HERMES_HOME ?? '/opt/data',
    '.tmp',
    'pdf-extract',
  )
  fs.mkdirSync(tmpDir, { recursive: true })
  const tmpPath = path.join(tmpDir, `${randomUUID()}.pdf`)
  fs.writeFileSync(tmpPath, buf)
  try {
    // Pass the PDF path via argv (sys.argv[1]) instead of f-string
    // interpolation. tmpPath is currently UUID-derived and safe, but
    // argv-passing closes the entire shell/python interpolation class
    // so future callers can't accidentally re-introduce an injection.
    const script = `
import sys, pymupdf
doc = pymupdf.open(sys.argv[1])
out = []
for page in doc:
    out.append(page.get_text())
sys.stdout.write('\\n\\n'.join(out))
`.trim()
    const result = await swarmExec('python3', ['-c', script, tmpPath], {
      timeoutMs: 30_000,
    })
    if (!result.ok) {
      return {
        ok: false,
        text: '',
        truncated: false,
        originalSize: buf.length,
        error: result.stderr || 'pymupdf extraction failed',
      }
    }
    const truncated = result.stdout.length > MAX_TEXT_BYTES
    const text = truncated
      ? `${result.stdout.slice(0, MAX_TEXT_BYTES)}\n\n[…PDF truncated at ${MAX_TEXT_BYTES} chars]`
      : result.stdout
    return {
      ok: true,
      text,
      truncated,
      originalSize: buf.length,
    }
  } finally {
    try {
      fs.unlinkSync(tmpPath)
    } catch {
      /* best-effort cleanup */
    }
  }
}

export async function extractAttachmentText(
  att: RawAttachment,
): Promise<ExtractionResult> {
  const name = att.name?.trim() || 'attachment'
  const contentType = (att.contentType ?? '').toLowerCase()
  const ext = getExtension(name)

  // Image fast path — leave raw for multimodal use.
  if (contentType.startsWith('image/')) {
    return {
      kind: 'image',
      name,
      contentType,
      dataUrl: att.dataUrl ?? '',
    }
  }

  const isText =
    TEXT_MIME_PREFIXES.some((p) => contentType.startsWith(p)) ||
    TEXT_MIME_EXACT.has(contentType) ||
    TEXT_EXT_FALLBACK.has(ext)

  if (isText) {
    const buf = att.dataUrl
      ? decodeBase64(att.dataUrl)
      : att.base64
        ? Buffer.from(att.base64, 'base64')
        : Buffer.from('')
    const originalSize = buf.length
    const truncated = originalSize > MAX_TEXT_BYTES
    const text = (truncated ? buf.subarray(0, MAX_TEXT_BYTES) : buf).toString(
      'utf-8',
    )
    const finalText = truncated
      ? `${text}\n\n[…file truncated at ${MAX_TEXT_BYTES} bytes (${originalSize} total)]`
      : text
    return {
      kind: 'text',
      name,
      contentType: contentType || `text/plain`,
      text: finalText,
      truncated,
      originalSize,
    }
  }

  // PDF — extract via PyMuPDF in the hermes-agent container.
  if (contentType === 'application/pdf' || ext === '.pdf') {
    const buf = att.dataUrl
      ? decodeBase64(att.dataUrl)
      : att.base64
        ? Buffer.from(att.base64, 'base64')
        : Buffer.from('')
    if (buf.length === 0) {
      return {
        kind: 'unsupported',
        name,
        contentType: 'application/pdf',
        hint: 'Leere PDF-Datei.',
      }
    }
    const r = await extractPdfTextViaDockerExec(buf)
    if (!r.ok || !r.text) {
      return {
        kind: 'unsupported',
        name,
        contentType: 'application/pdf',
        hint:
          r.error ?? 'PDF konnte nicht gelesen werden (kein Text extrahiert).',
      }
    }
    return {
      kind: 'text',
      name,
      contentType: 'application/pdf',
      text: r.text,
      truncated: r.truncated,
      originalSize: r.originalSize,
    }
  }

  return {
    kind: 'unsupported',
    name,
    contentType: contentType || 'application/octet-stream',
    hint: 'Dateityp nicht unterstützt — Text/Markdown/Code/PDF/Bilder funktionieren.',
  }
}

/**
 * Build a single string block that bundles all extracted text attachments
 * for inlining into a chat message. Each file gets a tagged section so the
 * model can refer to it by name.
 */
export function renderTextAttachmentsAsBlock(
  results: Array<ExtractionResult>,
): string {
  const texts = results.filter(
    (r): r is ExtractedText => r.kind === 'text' && r.text.length > 0,
  )
  if (texts.length === 0) return ''
  const blocks = texts.map(
    (t) =>
      `<attachment name="${escapeAttr(t.name)}" content-type="${escapeAttr(
        t.contentType,
      )}"${t.truncated ? ' truncated="true"' : ''}>\n${t.text}\n</attachment>`,
  )
  return blocks.join('\n\n')
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
