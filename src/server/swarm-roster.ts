import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as yaml from 'yaml'
import { z } from 'zod'
import { writeTextAtomic } from './atomic-write'
import { SWARM_CANONICAL_REPO } from './swarm-environment'
import { resolveSwarmModelLabel } from './swarm-model-resolver'

/**
 * Set when readSwarmRoster() encounters a parse failure on disk. While
 * true, writeSwarmRoster() refuses to overwrite the file — otherwise a
 * single bad save would silently revert all customisations to the
 * fallback. Reset on the next clean read.
 */
let lastReadFailed = false

/**
 * Validation for the `model:` field at write boundaries (POST / PATCH).
 * Read-side schema stays permissive so legacy rosters with unknown labels
 * never wedge a worker — only inbound user-supplied values are constrained.
 *
 * Allowed values: empty string, the literal default `'Worker'`, or any
 * label that the resolver maps to a concrete provider/model. Anything
 * else is rejected so a malicious PATCH cannot smuggle quotes, newlines,
 * or shell metacharacters into downstream consumers.
 */
const ValidatedModelLabel = z
  .string()
  .max(120, 'model label too long')
  .refine(
    (v) => v === '' || v === 'Worker' || resolveSwarmModelLabel(v) !== null,
    { message: 'unknown model label' },
  )

export const SWARM_ROSTER_PATH = join(SWARM_CANONICAL_REPO, 'swarm.yaml')

export const SwarmRosterWorkerSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  role: z.string().default('Worker'),
  specialty: z.string().default(''),
  model: z.string().default('Worker'),
  mission: z.string().default('Awaiting orchestrator dispatch.'),
  skills: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]),
  defaultCwd: z.string().optional(),
  preferredTaskTypes: z.array(z.string()).default([]),
  maxConcurrentTasks: z.number().int().positive().default(1),
  acceptsBroadcast: z.boolean().default(true),
  reviewRequired: z.boolean().default(false),
  // B6 — optional per-worker docker container override. Unset → uses
  // HERMES_VPS_CONTAINER env. Set this to spread workers across multiple
  // hermes-agent containers for true parallelism.
  container: z.string().optional(),
})

export const SwarmRosterSchema = z.object({
  version: z.number().int().positive().default(1),
  workers: z.array(SwarmRosterWorkerSchema).default([]),
})

export type SwarmRosterWorker = z.infer<typeof SwarmRosterWorkerSchema>
export type SwarmRoster = z.infer<typeof SwarmRosterSchema>

export const SwarmRosterUpsertSchema = SwarmRosterWorkerSchema.extend({
  id: z.string().regex(/^swarm\d+$/i, 'worker id must look like swarm13'),
  model: ValidatedModelLabel.default('Worker'),
})

export type SwarmRosterUpsert = z.infer<typeof SwarmRosterUpsertSchema>

function defaultRoleFromId(id: string): string {
  const n = id.match(/(\d+)/)?.[1] ?? ''
  switch (n) {
    case '1':
    case '12':
      return 'PR / Issues'
    case '2':
      return 'Backend Foundation'
    case '3':
      return 'Main Session Mirror'
    case '4':
      return 'Research'
    case '5':
    case '10':
      return 'Builder'
    case '6':
    case '11':
      return 'Reviewer'
    case '7':
      return 'Docs'
    case '8':
      return 'Ops'
    case '9':
      return 'Hackathon'
    default:
      return 'Worker'
  }
}

export function fallbackRoster(ids: Array<string> = []): SwarmRoster {
  return {
    version: 1,
    workers: ids.map((id) => ({
      id,
      name: id.replace(/^swarm/i, 'Swarm'),
      role: defaultRoleFromId(id),
      specialty: '',
      model: 'Worker',
      mission: 'Awaiting orchestrator dispatch.',
      skills: [],
      capabilities: [],
      preferredTaskTypes: [],
      maxConcurrentTasks: 1,
      acceptsBroadcast: true,
      reviewRequired: false,
    })),
  }
}

export function readSwarmRoster(ids: Array<string> = []): SwarmRoster {
  if (!existsSync(SWARM_ROSTER_PATH)) {
    lastReadFailed = false
    return fallbackRoster(ids)
  }
  try {
    const raw = yaml.parse(readFileSync(SWARM_ROSTER_PATH, 'utf-8')) as unknown
    const parsed = SwarmRosterSchema.parse(raw)
    const byId = new Map(parsed.workers.map((worker) => [worker.id, worker]))
    for (const fallback of fallbackRoster(ids).workers) {
      if (!byId.has(fallback.id)) byId.set(fallback.id, fallback)
    }
    lastReadFailed = false
    return { version: parsed.version, workers: [...byId.values()] }
  } catch (err) {
    // Surface the failure (used to be swallowed) so writeSwarmRoster can
    // refuse to overwrite a file we can't parse — a single bad save was
    // permanently wiping all per-worker customisations.
    lastReadFailed = true
    console.error(
      `swarm-roster: failed to parse ${SWARM_ROSTER_PATH}, falling back to defaults but refusing to overwrite until cleared`,
      err,
    )
    // Best-effort: snapshot the broken file so the operator can recover.
    try {
      const backup = `${SWARM_ROSTER_PATH}.broken-${Date.now()}`
      writeTextAtomic(backup, readFileSync(SWARM_ROSTER_PATH, 'utf-8'))
    } catch {
      // ignore — backup is best-effort
    }
    return fallbackRoster(ids)
  }
}

export function writeSwarmRoster(roster: SwarmRoster): void {
  if (lastReadFailed) {
    throw new Error(
      'swarm-roster: refusing to overwrite an unparseable swarm.yaml — fix or remove the file first',
    )
  }
  const parsed = SwarmRosterSchema.parse(roster)
  const doc = yaml.stringify(parsed, { lineWidth: 0 })
  writeTextAtomic(SWARM_ROSTER_PATH, doc)
}

export function upsertSwarmRosterWorker(input: SwarmRosterUpsert, ids: Array<string> = []): SwarmRoster {
  const nextWorker = SwarmRosterUpsertSchema.parse(input)
  const current = readSwarmRoster(ids)
  const byId = new Map(current.workers.map((worker) => [worker.id, worker]))
  byId.set(nextWorker.id, nextWorker)
  const next: SwarmRoster = {
    version: current.version || 1,
    workers: [...byId.values()].sort((a, b) => {
      const na = parseInt(a.id.replace(/\D/g, ''), 10) || 0
      const nb = parseInt(b.id.replace(/\D/g, ''), 10) || 0
      return na - nb
    }),
  }
  writeSwarmRoster(next)
  return next
}

/**
 * Partial update — only the fields you pass are touched. The worker must
 * already exist; missing workers throw. Useful from UI dialogs that only
 * edit a subset of fields (model, role, name, mission).
 */
export const SwarmRosterPatchSchema = z
  .object({
    id: z.string().regex(/^swarm\d+$/i, 'worker id must look like swarm13'),
  })
  .merge(SwarmRosterWorkerSchema.partial().omit({ id: true, model: true }))
  .extend({ model: ValidatedModelLabel.optional() })

export type SwarmRosterPatch = z.infer<typeof SwarmRosterPatchSchema>

export function patchSwarmRosterWorker(
  input: SwarmRosterPatch,
  ids: Array<string> = [],
): SwarmRoster {
  const patch = SwarmRosterPatchSchema.parse(input)
  const current = readSwarmRoster(ids)
  const existing = current.workers.find((worker) => worker.id === patch.id)
  if (!existing) {
    throw new Error(`worker ${patch.id} not in roster — use POST to add new`)
  }
  const merged: SwarmRosterWorker = { ...existing, ...patch }
  return upsertSwarmRosterWorker(merged, ids)
}

export function rosterByWorkerId(ids: Array<string> = []): Map<string, SwarmRosterWorker> {
  return new Map(readSwarmRoster(ids).workers.map((worker) => [worker.id, worker]))
}
