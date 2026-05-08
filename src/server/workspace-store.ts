/**
 * Workspace-store: meta.json + members.json with mtime-invalidated
 * in-memory cache so `canDo()` runs O(1) on the hot path (Plan AK29 +
 * Plan F6 atomic writes).
 *
 * Layout:
 *   data/workspaces/<wsId>/meta.json         (WorkspaceMeta)
 *   data/workspaces/<wsId>/members.json      (WorkspaceMembers)
 *
 * Cache strategy: read once, then `statSync(file).mtimeMs` is
 * compared on every subsequent get. If the mtime advanced, the file
 * is reloaded — so a member-add via another process / CLI tool /
 * cluster peer is picked up at the latest on the next call. This
 * gives soft-delete (D4 / AK29) immediate effect: the moment
 * `meta.deletedAt` is written, the next permission check sees it.
 *
 * All writes go through `withMutex` keyed by file path so concurrent
 * Add/Remove/Role-Change can't lose updates.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { writeJsonAtomic, withMutex } from './atomic-write'
import { getDataDir, getWorkspaceDir, isValidSlug } from './data-paths'
import { assertSchemaVersion } from './json-schema-version'

export const WORKSPACE_META_SCHEMA_VERSION = 1
export const WORKSPACE_MEMBERS_SCHEMA_VERSION = 1

export type WorkspaceRole = 'owner' | 'admin' | 'member'

export type WorkspaceMeta = {
  schemaVersion: 1
  id: string
  name: string
  description?: string
  createdAt: string
  createdBy: string
  branding: {
    primaryColor: string
    logoUrl?: string
  }
  settings: {
    defaultModel?: string
    features: Record<string, boolean>
  }
  deletedAt?: string
  deletedBy?: string
}

export type WorkspaceMember = {
  userId: string
  role: WorkspaceRole
  joinedAt: string
  addedBy: string
}

export type WorkspaceMembers = {
  schemaVersion: 1
  members: Array<WorkspaceMember>
}

// ─── Cache ──────────────────────────────────────────────────────────

type CacheEntry<T> = { mtimeMs: number; value: T }

const metaCache = new Map<string, CacheEntry<WorkspaceMeta>>()
const membersCache = new Map<string, CacheEntry<WorkspaceMembers>>()

function metaPath(wsId: string): string {
  return join(getWorkspaceDir(wsId), 'meta.json')
}

function membersPath(wsId: string): string {
  return join(getWorkspaceDir(wsId), 'members.json')
}

function metaMutex(wsId: string): string {
  return `meta:${wsId}`
}

function membersMutex(wsId: string): string {
  return `members:${wsId}`
}

function ensureValidId(wsId: string): void {
  if (!isValidSlug(wsId)) {
    throw new Error(`[workspace-store] invalid wsId: ${JSON.stringify(wsId)}`)
  }
}

function loadFresh<T extends { schemaVersion: number }>(
  path: string,
  cache: Map<string, CacheEntry<T>>,
  cacheKey: string,
): T | null {
  if (!existsSync(path)) {
    cache.delete(cacheKey)
    return null
  }
  const stat = statSync(path)
  const cached = cache.get(cacheKey)
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.value
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    const validated = assertSchemaVersion<T>(raw, 1, path)
    cache.set(cacheKey, { mtimeMs: stat.mtimeMs, value: validated })
    return validated
  } catch {
    cache.delete(cacheKey)
    return null
  }
}

// ─── Meta ───────────────────────────────────────────────────────────

export function getWorkspaceMeta(wsId: string): WorkspaceMeta | null {
  ensureValidId(wsId)
  return loadFresh(metaPath(wsId), metaCache, wsId)
}

export type CreateWorkspaceInput = {
  id: string
  name: string
  createdBy: string
  description?: string
  branding?: { primaryColor: string; logoUrl?: string }
  settings?: { defaultModel?: string; features?: Record<string, boolean> }
}

const DEFAULT_BRANDING_COLOR = '#5B6CFF'

export async function createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceMeta> {
  ensureValidId(input.id)
  if (!isValidSlug(input.createdBy)) {
    throw new Error(`[workspace-store] invalid createdBy: ${JSON.stringify(input.createdBy)}`)
  }
  if (existsSync(metaPath(input.id))) {
    throw new Error(`[workspace-store] workspace already exists: ${input.id}`)
  }
  return withMutex(metaMutex(input.id), async () => {
    const meta: WorkspaceMeta = {
      schemaVersion: 1,
      id: input.id,
      name: input.name,
      description: input.description,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
      branding: input.branding ?? { primaryColor: DEFAULT_BRANDING_COLOR },
      settings: {
        defaultModel: input.settings?.defaultModel,
        features: input.settings?.features ?? {},
      },
    }
    mkdirSync(dirname(metaPath(input.id)), { recursive: true })
    writeJsonAtomic(metaPath(input.id), meta)
    metaCache.delete(input.id) // force reload on next get (mtime might be reused on fast FS)
    return meta
  })
}

export async function updateWorkspaceMeta(
  wsId: string,
  patch: (current: WorkspaceMeta | null) => WorkspaceMeta | null,
): Promise<WorkspaceMeta | null> {
  ensureValidId(wsId)
  return withMutex(metaMutex(wsId), async () => {
    const current = getWorkspaceMeta(wsId)
    const next = patch(current)
    if (next === null) return current
    if (next.id !== wsId) {
      throw new Error(`[workspace-store] meta patch must not change id`)
    }
    writeJsonAtomic(metaPath(wsId), next)
    metaCache.delete(wsId)
    return next
  })
}

export async function softDeleteWorkspace(wsId: string, deletedBy: string): Promise<WorkspaceMeta | null> {
  return updateWorkspaceMeta(wsId, (current) => {
    if (!current) return null
    if (current.deletedAt) return current // already soft-deleted
    return { ...current, deletedAt: new Date().toISOString(), deletedBy }
  })
}

export async function restoreWorkspace(wsId: string): Promise<WorkspaceMeta | null> {
  return updateWorkspaceMeta(wsId, (current) => {
    if (!current) return null
    const next = { ...current }
    delete next.deletedAt
    delete next.deletedBy
    return next
  })
}

export function isWorkspaceActive(meta: WorkspaceMeta | null): meta is WorkspaceMeta {
  return !!meta && !meta.deletedAt
}

export function listWorkspaces(opts: { includeDeleted?: boolean } = {}): Array<string> {
  const wsRoot = join(getDataDir(), 'workspaces')
  if (!existsSync(wsRoot)) return []
  if (!statSync(wsRoot).isDirectory()) return []
  return readdirSync(wsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isValidSlug(e.name))
    .map((e) => e.name)
    .filter((wsId) => {
      if (opts.includeDeleted) return true
      const meta = getWorkspaceMeta(wsId)
      return isWorkspaceActive(meta)
    })
    .sort()
}

// ─── Members ────────────────────────────────────────────────────────

const EMPTY_MEMBERS: WorkspaceMembers = { schemaVersion: 1, members: [] }

export function getWorkspaceMembers(wsId: string): WorkspaceMembers {
  ensureValidId(wsId)
  const loaded = loadFresh(membersPath(wsId), membersCache, wsId)
  return loaded ?? EMPTY_MEMBERS
}

export function getMember(wsId: string, userId: string): WorkspaceMember | null {
  return getWorkspaceMembers(wsId).members.find((m) => m.userId === userId) ?? null
}

export type AddMemberInput = {
  wsId: string
  userId: string
  role: WorkspaceRole
  addedBy: string
}

export async function addMember(input: AddMemberInput): Promise<WorkspaceMembers> {
  ensureValidId(input.wsId)
  if (!isValidSlug(input.userId)) {
    throw new Error(`[workspace-store] invalid userId: ${JSON.stringify(input.userId)}`)
  }
  return withMutex(membersMutex(input.wsId), async () => {
    const current = loadFresh(membersPath(input.wsId), membersCache, input.wsId) ?? EMPTY_MEMBERS
    const existing = current.members.find((m) => m.userId === input.userId)
    if (existing) {
      throw new Error(`[workspace-store] member already exists: ${input.userId} in ${input.wsId}`)
    }
    const next: WorkspaceMembers = {
      schemaVersion: 1,
      members: [
        ...current.members,
        {
          userId: input.userId,
          role: input.role,
          joinedAt: new Date().toISOString(),
          addedBy: input.addedBy,
        },
      ],
    }
    mkdirSync(dirname(membersPath(input.wsId)), { recursive: true })
    writeJsonAtomic(membersPath(input.wsId), next)
    membersCache.delete(input.wsId)
    return next
  })
}

export async function removeMember(wsId: string, userId: string): Promise<WorkspaceMembers> {
  ensureValidId(wsId)
  return withMutex(membersMutex(wsId), async () => {
    const current = loadFresh(membersPath(wsId), membersCache, wsId) ?? EMPTY_MEMBERS
    const member = current.members.find((m) => m.userId === userId)
    if (!member) return current
    if (member.role === 'owner') {
      const otherOwners = current.members.filter(
        (m) => m.role === 'owner' && m.userId !== userId,
      )
      if (otherOwners.length === 0) {
        throw new Error(
          `[workspace-store] cannot remove last owner of workspace ${wsId} — transfer ownership first`,
        )
      }
    }
    const next: WorkspaceMembers = {
      schemaVersion: 1,
      members: current.members.filter((m) => m.userId !== userId),
    }
    writeJsonAtomic(membersPath(wsId), next)
    membersCache.delete(wsId)
    return next
  })
}

export async function changeMemberRole(
  wsId: string,
  userId: string,
  newRole: WorkspaceRole,
): Promise<WorkspaceMembers> {
  ensureValidId(wsId)
  return withMutex(membersMutex(wsId), async () => {
    const current = loadFresh(membersPath(wsId), membersCache, wsId) ?? EMPTY_MEMBERS
    const idx = current.members.findIndex((m) => m.userId === userId)
    if (idx === -1) {
      throw new Error(`[workspace-store] member not found: ${userId} in ${wsId}`)
    }
    const old = current.members[idx]
    if (old.role === newRole) return current
    if (old.role === 'owner' && newRole !== 'owner') {
      const otherOwners = current.members.filter(
        (m) => m.role === 'owner' && m.userId !== userId,
      )
      if (otherOwners.length === 0) {
        throw new Error(
          `[workspace-store] cannot demote last owner of workspace ${wsId} — promote a successor first`,
        )
      }
    }
    const next: WorkspaceMembers = {
      schemaVersion: 1,
      members: current.members.map((m, i) => (i === idx ? { ...m, role: newRole } : m)),
    }
    writeJsonAtomic(membersPath(wsId), next)
    membersCache.delete(wsId)
    return next
  })
}

/**
 * Test-only: clear the in-memory caches so a fresh test fixture sees
 * a freshly-loaded view from disk.
 */
export function _clearWorkspaceCachesForTests(): void {
  metaCache.clear()
  membersCache.clear()
}
