/**
 * Standing-Mission tick — looks for swarm workers that are idle AND have
 * a non-default `mission:` set in `swarm.yaml`, then dispatches each
 * mission as a fresh task. Designed to be polled from the Swarm UI every
 * 60s while the page is open.
 *
 * Cooldown: each worker can be re-tickled at most once per 5 minutes to
 * prevent runaway loops if the worker keeps coming back as idle without
 * making progress. Cooldown lives in-memory (resets with the workspace
 * server restart — that's intentional, no need to persist).
 *
 * Triggered standing missions go through the regular dispatch endpoint
 * with allowAsync:true, waitForCheckpoint:false so the call returns
 * immediately while the worker actually does the work.
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireActiveWorkspaceMember } from '../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { requireJsonContentType } from '../../server/rate-limit'
import {
  getSwarmProfilePath,
  listSwarmWorkerIds,
  readSwarmRuntimeFile,
} from '../../server/swarm-foundation'
import { rosterByWorkerId } from '../../server/swarm-roster'

const COOLDOWN_MS = 5 * 60 * 1000
const lastTickByWorker = new Map<string, number>()
const DEFAULT_MISSION = 'Awaiting orchestrator dispatch.'

type TickResult = {
  workerId: string
  action: 'dispatched' | 'skipped' | 'error'
  reason: string
}

export const Route = createFileRoute('/api/swarm-idle-tick')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = requireActiveWorkspaceMember(request)
        if (!auth.ok) return auth.response
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        const ids = listSwarmWorkerIds({ swarmOnly: true })
        const roster = rosterByWorkerId(ids)
        const now = Date.now()
        const results: Array<TickResult> = []
        const dispatchTargets: Array<{ workerId: string; task: string }> = []

        for (const workerId of ids) {
          const entry = roster.get(workerId)
          const mission = entry?.mission?.trim() ?? ''
          if (!mission || mission === DEFAULT_MISSION) {
            results.push({
              workerId,
              action: 'skipped',
              reason: 'no standing mission set',
            })
            continue
          }
          let runtimeState: string | null = null
          try {
            const runtime = readSwarmRuntimeFile(
              getSwarmProfilePath(workerId),
              workerId,
            )
            runtimeState = runtime?.runtime?.state ?? null
          } catch (err) {
            results.push({
              workerId,
              action: 'error',
              reason: `runtime read failed: ${(err as Error).message}`,
            })
            continue
          }
          if (runtimeState && runtimeState !== 'idle') {
            results.push({
              workerId,
              action: 'skipped',
              reason: `state=${runtimeState}`,
            })
            continue
          }
          const last = lastTickByWorker.get(workerId) ?? 0
          if (now - last < COOLDOWN_MS) {
            const remainingS = Math.ceil((COOLDOWN_MS - (now - last)) / 1000)
            results.push({
              workerId,
              action: 'skipped',
              reason: `cooldown (${remainingS}s)`,
            })
            continue
          }
          dispatchTargets.push({ workerId, task: mission })
          lastTickByWorker.set(workerId, now)
        }

        if (dispatchTargets.length > 0) {
          // Reuse the existing dispatch endpoint — its routing, profile
          // handling, mission tracking, and notification side-effects are
          // exactly what we want for standing missions.
          const origin = new URL(request.url).origin
          const cookie = request.headers.get('cookie') ?? ''
          try {
            const res = await fetch(`${origin}/api/swarm-dispatch`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                cookie,
              },
              body: JSON.stringify({
                assignments: dispatchTargets.map((t) => ({
                  workerId: t.workerId,
                  task: t.task,
                  rationale: 'Standing mission auto-tick',
                })),
                allowAsync: true,
                waitForCheckpoint: false,
                missionTitle: `Standing mission tick (${dispatchTargets.length})`,
              }),
            })
            if (!res.ok) {
              const text = await res.text().catch(() => '')
              for (const t of dispatchTargets) {
                results.push({
                  workerId: t.workerId,
                  action: 'error',
                  reason: `dispatch HTTP ${res.status}: ${text.slice(0, 120)}`,
                })
              }
            } else {
              for (const t of dispatchTargets) {
                results.push({
                  workerId: t.workerId,
                  action: 'dispatched',
                  reason: 'standing mission dispatched',
                })
              }
            }
          } catch (err) {
            for (const t of dispatchTargets) {
              results.push({
                workerId: t.workerId,
                action: 'error',
                reason: `dispatch failed: ${(err as Error).message}`,
              })
            }
          }
        }

        return json({
          ok: true,
          tickedAt: now,
          dispatched: results.filter((r) => r.action === 'dispatched').length,
          skipped: results.filter((r) => r.action === 'skipped').length,
          errors: results.filter((r) => r.action === 'error').length,
          results,
        })
      },
    },
  },
})
