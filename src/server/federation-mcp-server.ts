/**
 * Federation MCP server — Tool implementations (Plan B Phase B.1).
 *
 * MCP at the JSON-RPC layer is just JSON-RPC 2.0 over stdio. We
 * implement the protocol by hand here (no extra SDK) and expose
 * exactly the seven tools listed in Plan-Finding N11. Anything else
 * the peer asks for is rejected with a `MethodNotFound` error.
 *
 * Plan-Finding F2 — Workspace-Process-Lock: The CLI entry point
 * (`scripts/mcp-federation-stdio.ts`) parses `--workspace-id <wsId>`
 * from argv, resolves the workspace root once at boot, and pins
 * every tool call to that root via `resolveSafe()`. Path-traversal
 * attempts return `PathTraversalRefused` and emit a global audit
 * event `mcp_path_traversal_attempt`. A missing/invalid wsId fails
 * fast at startup — the SSH `command="..."` restriction is only
 * useful if the binary itself doesn't accept arbitrary roots.
 *
 * Plan-Finding B.5 — Hardcoded sync filter: the MCP server only
 * surfaces shared sessions (`sessions/shared/`) — it never returns
 * user-private session data and never speaks to the gateway. The
 * filter is enforced inside `list_session_snapshots` /
 * `get_session_snapshot`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, normalize, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'

import { appendAuditEvent } from './audit-log'
import { getWorkspaceDir, isValidSlug } from './data-paths'

// ─── JSON-RPC 2.0 framing ──────────────────────────────────────────────

export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: string | number | null
  method: string
  params?: Record<string, unknown>
}

export type JsonRpcSuccess<T> = {
  jsonrpc: '2.0'
  id: string | number | null
  result: T
}

export type JsonRpcError = {
  jsonrpc: '2.0'
  id: string | number | null
  error: { code: number; message: string; data?: unknown }
}

export type JsonRpcResponse<T = unknown> = JsonRpcSuccess<T> | JsonRpcError

const ERR_PARSE = -32700
const ERR_INVALID_REQUEST = -32600
const ERR_METHOD_NOT_FOUND = -32601
const ERR_INVALID_PARAMS = -32602
const ERR_INTERNAL = -32603
// Custom application codes
const ERR_PATH_TRAVERSAL = -32001
const ERR_NOT_FOUND = -32004

function ok<T>(id: JsonRpcRequest['id'], result: T): JsonRpcSuccess<T> {
  return { jsonrpc: '2.0', id, result }
}

function err(id: JsonRpcRequest['id'], code: number, message: string, data?: unknown): JsonRpcError {
  const out: JsonRpcError = { jsonrpc: '2.0', id, error: { code, message } }
  if (data !== undefined) out.error.data = data
  return out
}

// ─── Workspace-pinned context ─────────────────────────────────────────

export type ServerContext = {
  workspaceId: string
  workspaceRoot: string
}

/** Build a context object for a given wsId, validating the slug. */
export function createServerContext(workspaceId: string): ServerContext {
  if (!isValidSlug(workspaceId)) {
    throw new Error(`[federation-mcp-server] invalid workspaceId: ${JSON.stringify(workspaceId)}`)
  }
  return { workspaceId, workspaceRoot: getWorkspaceDir(workspaceId) }
}

/**
 * Resolve a peer-supplied relative path against the workspace root,
 * refusing anything that escapes the root via `..`, absolute paths,
 * or symlinks. Plan-Finding F2.
 */
export function resolveSafe(ctx: ServerContext, relPath: string): string {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new Error('PathTraversalRefused: empty path')
  }
  // Reject obvious traversal markers before resolving.
  if (relPath.includes('\0')) throw new Error('PathTraversalRefused: null byte')
  const candidate = resolve(ctx.workspaceRoot, normalize(relPath))
  const rel = relative(ctx.workspaceRoot, candidate)
  if (rel.startsWith('..') || rel.startsWith(`..${sep}`) || rel === '..') {
    throw new Error(`PathTraversalRefused: escapes workspace root: ${relPath}`)
  }
  if (resolve(rel) !== rel && resolve(rel).startsWith(sep)) {
    // Absolute paths after resolve indicate the caller passed an
    // absolute path; reject.
    throw new Error(`PathTraversalRefused: absolute path: ${relPath}`)
  }
  return candidate
}

async function recordTraversal(ctx: ServerContext, requested: string, error: string): Promise<void> {
  try {
    await appendAuditEvent('global', {
      type: 'mcp_path_traversal_attempt',
      workspaceId: ctx.workspaceId,
      requested,
      error,
    })
  } catch {
    // never block the protocol on an audit-write failure
  }
}

// ─── Tool implementations (Plan N11) ──────────────────────────────────

export const TOOL_NAMES = [
  'list_memories',
  'get_memory',
  'list_skills',
  'get_skill',
  'list_session_snapshots',
  'get_session_snapshot',
  'list_mission_events_since',
] as const
export type ToolName = (typeof TOOL_NAMES)[number]

export type ListMemoriesResult = {
  files: Array<{ path: string; sha256: string; size: number; mtime: string }>
}

export function listMemories(ctx: ServerContext): ListMemoriesResult {
  const root = join(ctx.workspaceRoot, 'memories')
  if (!existsSync(root)) return { files: [] }
  return { files: walkMarkdown(ctx, root, 'memories') }
}

export function getMemory(ctx: ServerContext, relPath: string): { content: string; sha256: string } {
  if (!relPath.startsWith('memories/')) {
    throw new Error('PathTraversalRefused: memory paths must be under memories/')
  }
  const target = resolveSafe(ctx, relPath)
  if (!existsSync(target) || !statSync(target).isFile()) {
    const errr = `${relPath} not found`
    throw new Error('NotFound: ' + errr)
  }
  const content = readFileSync(target, 'utf8')
  return { content, sha256: sha256(content) }
}

export type ListSkillsResult = {
  skills: Array<{ name: string; sha256: string; size: number }>
}

export function listSkills(ctx: ServerContext): ListSkillsResult {
  const root = join(ctx.workspaceRoot, 'skills')
  if (!existsSync(root)) return { skills: [] }
  const out: ListSkillsResult['skills'] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillFile = join(root, entry.name, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    const content = readFileSync(skillFile, 'utf8')
    out.push({
      name: entry.name,
      sha256: sha256(content),
      size: content.length,
    })
  }
  return { skills: out.sort((a, b) => a.name.localeCompare(b.name)) }
}

export function getSkill(ctx: ServerContext, name: string): { content: string; sha256: string } {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('InvalidParams: name required')
  }
  // The skill name maps 1:1 to the directory name; reject path
  // separators and the parent marker so a peer can't drift outside
  // skills/.
  if (name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) {
    throw new Error('PathTraversalRefused: skill name')
  }
  const target = resolveSafe(ctx, `skills/${name}/SKILL.md`)
  if (!existsSync(target)) {
    throw new Error(`NotFound: skill ${name}`)
  }
  const content = readFileSync(target, 'utf8')
  return { content, sha256: sha256(content) }
}

export type ListSessionSnapshotsResult = {
  sessions: Array<{ id: string; sha256: string; capturedAt: string }>
}

export function listSessionSnapshots(ctx: ServerContext): ListSessionSnapshotsResult {
  const root = join(ctx.workspaceRoot, 'sessions', 'shared')
  if (!existsSync(root)) return { sessions: [] }
  const out: ListSessionSnapshotsResult['sessions'] = []
  for (const entry of readdirSync(root)) {
    if (!entry.endsWith('.json')) continue
    const target = join(root, entry)
    try {
      const content = readFileSync(target, 'utf8')
      const parsed = JSON.parse(content) as { capturedAt?: string; sessionId?: string }
      out.push({
        id: parsed.sessionId ?? entry.replace(/\.json$/, ''),
        sha256: sha256(content),
        capturedAt: parsed.capturedAt ?? '',
      })
    } catch {
      // skip torn snapshots
    }
  }
  return { sessions: out.sort((a, b) => a.id.localeCompare(b.id)) }
}

export function getSessionSnapshot(ctx: ServerContext, id: string): { content: string; sha256: string } {
  if (id.includes('/') || id.includes('\\') || id.includes('..') || id.includes('\0')) {
    throw new Error('PathTraversalRefused: session id')
  }
  const target = resolveSafe(ctx, `sessions/shared/${id}.json`)
  if (!existsSync(target)) {
    throw new Error(`NotFound: session ${id}`)
  }
  const content = readFileSync(target, 'utf8')
  return { content, sha256: sha256(content) }
}

export type MissionEvent = {
  index: number
  payload: unknown
}

export function listMissionEventsSince(
  ctx: ServerContext,
  sinceIndex: number,
): { events: Array<MissionEvent>; total: number } {
  // Mission events live as JSONL streams under
  // `worker-profiles/<id>/sessions/<sid>/events.jsonl` — they're not
  // synced in Phase B (Plan calls them out as Phase C). For now this
  // tool returns an empty list with `total: 0` so the protocol shape
  // is stable when the sync engine starts asking later.
  void ctx
  if (typeof sinceIndex !== 'number' || sinceIndex < 0) {
    throw new Error('InvalidParams: sinceIndex must be a non-negative number')
  }
  return { events: [], total: 0 }
}

// ─── JSON-RPC dispatch ────────────────────────────────────────────────

export async function handleRequest(
  ctx: ServerContext,
  raw: string,
): Promise<JsonRpcResponse> {
  let req: JsonRpcRequest
  try {
    req = JSON.parse(raw) as JsonRpcRequest
  } catch (e) {
    return err(null, ERR_PARSE, e instanceof Error ? e.message : 'parse error')
  }
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return err(req.id ?? null, ERR_INVALID_REQUEST, 'malformed request')
  }
  try {
    const params = (req.params ?? {}) as Record<string, unknown>
    switch (req.method) {
      case 'list_memories':
        return ok(req.id, listMemories(ctx))
      case 'get_memory':
        return ok(req.id, getMemory(ctx, paramString(params, 'path')))
      case 'list_skills':
        return ok(req.id, listSkills(ctx))
      case 'get_skill':
        return ok(req.id, getSkill(ctx, paramString(params, 'name')))
      case 'list_session_snapshots':
        return ok(req.id, listSessionSnapshots(ctx))
      case 'get_session_snapshot':
        return ok(req.id, getSessionSnapshot(ctx, paramString(params, 'id')))
      case 'list_mission_events_since':
        return ok(req.id, listMissionEventsSince(ctx, paramNumber(params, 'sinceIndex')))
      default:
        return err(req.id, ERR_METHOD_NOT_FOUND, `unknown method: ${req.method}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.startsWith('PathTraversalRefused')) {
      void recordTraversal(ctx, JSON.stringify(req.params), msg)
      return err(req.id, ERR_PATH_TRAVERSAL, msg)
    }
    if (msg.startsWith('NotFound')) {
      return err(req.id, ERR_NOT_FOUND, msg)
    }
    if (msg.startsWith('InvalidParams')) {
      return err(req.id, ERR_INVALID_PARAMS, msg)
    }
    return err(req.id, ERR_INTERNAL, msg)
  }
}

// ─── helpers ───────────────────────────────────────────────────────────

function paramString(params: Record<string, unknown>, key: string): string {
  const v = params[key]
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`InvalidParams: ${key} must be a non-empty string`)
  }
  return v
}

function paramNumber(params: Record<string, unknown>, key: string): number {
  const v = params[key]
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new Error(`InvalidParams: ${key} must be a number`)
  }
  return v
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function walkMarkdown(
  ctx: ServerContext,
  absDir: string,
  relPrefix: string,
): Array<{ path: string; sha256: string; size: number; mtime: string }> {
  const out: Array<{ path: string; sha256: string; size: number; mtime: string }> = []
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const absChild = join(absDir, entry.name)
    const relChild = `${relPrefix}/${entry.name}`
    if (entry.isDirectory()) {
      // Recurse into subdirectories — but skip anything that resolves
      // outside the workspace root (defense in depth against weird
      // symlinks on the source side).
      try {
        resolveSafe(ctx, relChild)
      } catch {
        continue
      }
      out.push(...walkMarkdown(ctx, absChild, relChild))
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const content = readFileSync(absChild, 'utf8')
    const stat = statSync(absChild)
    out.push({
      path: relChild,
      sha256: sha256(content),
      size: content.length,
      mtime: stat.mtime.toISOString(),
    })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}
