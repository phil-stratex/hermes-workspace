/**
 * Federation-specific audit log (Plan B.2).
 *
 * Builds on `audit-log.ts` (already hash-chained, mtime-cached) and
 * adds a thin layer of typed event emitters for the federation
 * lifecycle. Storage is the workspace-scoped audit JSONL — events
 * land in `data/workspaces/<wsId>/audit/<YYYY-MM-DD>.jsonl` so they
 * sit alongside member/owner-handover/etc. events.
 *
 * Plan-Findings:
 *   - F10  every read recomputes the chain; tampering is visible
 *   - B.5  the audit log itself is opt-in-syncable but defaults
 *          OFF (configured per peer via `syncedTypes`)
 */

import { appendAuditEvent } from './audit-log'

export type FederationEvent =
  | { type: 'federation_peer_added'; actorUserId: string; peerId: string; peerName: string; remoteWorkspaceId: string }
  | { type: 'federation_peer_updated'; actorUserId: string; peerId: string; patch: Record<string, unknown> }
  | { type: 'federation_peer_deleted'; actorUserId: string; peerId: string }
  | { type: 'federation_connect'; actorUserId: string; peerId: string }
  | { type: 'federation_disconnect'; actorUserId: string; peerId: string; reason: 'manual' | 'idle-ttl' | 'error'; errorMessage?: string }
  | {
      type: 'federation_diff_computed'
      actorUserId: string
      peerId: string
      summary: { inCount: number; outCount: number; conflictCount: number }
      warnings: { massInDelete: boolean; massOutDelete: boolean }
    }
  | {
      type: 'federation_apply'
      actorUserId: string
      peerId: string
      applied: { add: number; update: number; delete: number }
      conflictsResolved: number
      summary: { in: number; out: number; conflicts: number }
    }
  | { type: 'federation_apply_skipped'; actorUserId: string; peerId: string; reason: string }
  | {
      type: 'federation_chain_break_detected'
      detectedBy: string
      peerId: string
      brokenAt: number
      breakReason?: string
    }

export async function emitFederationEvent(
  wsId: string,
  event: FederationEvent,
): Promise<void> {
  // Cast through unknown — `FederationEvent` is a discriminated union
  // whose `type` field carries the event-name; `AuditEventInput`
  // requires `type: string` plus an open record. The shapes are
  // structurally compatible, just not assignable through the strict
  // discriminated-union view.
  const payload = event as unknown as { type: string; [k: string]: unknown }
  await appendAuditEvent({ type: 'workspace', wsId }, payload)
}
