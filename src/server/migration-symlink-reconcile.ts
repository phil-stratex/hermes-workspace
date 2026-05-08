/**
 * Boot-time legacy symlink reconcile (Plan-Finding N1).
 *
 * The Hermes Swarm-Memory data lives under
 * `~/.openclaw/workspace/memory/swarm` on the legacy stack. The
 * multi-tenant migration moves the conceptual ownership of that
 * directory into `data/workspaces/<wsId>/memories/swarm/`, but
 * doing the move *inside the sidecar migration container* is brittle
 * — symlinks across host vs container filesystems get rewritten
 * inconsistently after the atomic stage→live rename. So instead of
 * trying to write the symlink during migration, we do it at every
 * boot:
 *
 *   if `data/workspaces/<wsId>/memories/swarm` is missing
 *      AND the legacy `~/.openclaw/.../swarm` exists
 *   then create a symlink target → legacy.
 *
 * Idempotent — does nothing on subsequent boots once the symlink
 * is in place. Safe against trash-and-restore: a freshly
 * soft-restored workspace gets its symlink back on the next boot.
 *
 * Audit: every reconcile emits a `legacy_symlink_reconciled` event
 * to the global audit log so an operator can see when and why a
 * symlink appeared.
 *
 * Hard-move (Phase A.6.1) is a separate, later patch.
 */

import { existsSync, mkdirSync, readdirSync, statSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { appendAuditEvent } from './audit-log'
import { getWorkspaceDir, isValidSlug } from './data-paths'
import { listWorkspaces } from './workspace-store'

export type ReconcileEntry = {
  wsId: string
  target: string
  legacy: string
  result: 'created' | 'already-present' | 'no-legacy' | 'error'
  errorMessage?: string
}

function defaultLegacyRoot(): string {
  return process.env.HERMES_LEGACY_SWARM_MEMORY_ROOT
    ?? join(homedir(), '.openclaw', 'workspace', 'memory', 'swarm')
}

export async function reconcileLegacySymlinks(opts: {
  legacyRoot?: string
} = {}): Promise<Array<ReconcileEntry>> {
  const legacy = opts.legacyRoot ?? defaultLegacyRoot()
  const out: Array<ReconcileEntry> = []
  for (const wsId of listWorkspaces({ includeDeleted: false })) {
    if (!isValidSlug(wsId)) continue
    const target = join(getWorkspaceDir(wsId), 'memories', 'swarm')
    const entry: ReconcileEntry = { wsId, target, legacy, result: 'already-present' }
    if (existsSync(target)) {
      // Either already a symlink, or a real directory — leave it alone.
      out.push({ ...entry, result: 'already-present' })
      continue
    }
    if (!existsSync(legacy)) {
      out.push({ ...entry, result: 'no-legacy' })
      continue
    }
    if (!isLegacyDir(legacy)) {
      out.push({ ...entry, result: 'no-legacy' })
      continue
    }
    if (!hasAnyContent(legacy)) {
      // Empty legacy dir is functionally equivalent to "no legacy"
      // — nothing to expose via the symlink.
      out.push({ ...entry, result: 'no-legacy' })
      continue
    }
    try {
      mkdirSync(dirname(target), { recursive: true })
      // On Windows, type='dir' requires admin / developer mode. Use
      // 'junction' as a fallback — NTFS junctions don't need elevated
      // privileges and behave like a dir-symlink for our use case.
      try {
        symlinkSync(legacy, target, 'dir')
      } catch (err) {
        if (process.platform === 'win32') {
          symlinkSync(legacy, target, 'junction')
        } else {
          throw err
        }
      }
      await appendAuditEvent('global', {
        type: 'legacy_symlink_reconciled',
        wsId,
        target,
        legacy,
      })
      out.push({ ...entry, result: 'created' })
    } catch (err) {
      out.push({
        ...entry,
        result: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return out
}

function isLegacyDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function hasAnyContent(path: string): boolean {
  try {
    return readdirSync(path).length > 0
  } catch {
    return false
  }
}
