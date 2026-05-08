/**
 * Project Runner — manages dev-servers for generated projects.
 *
 * The Hermes agent generates Next/Vite/Astro/etc. projects under
 * `${HERMES_WORKSPACE_DIR}/<projectDirRelative>/`. This module installs
 * dependencies and spawns `pnpm dev` (or equivalent) inside the
 * hermes-agent container via `swarmExec`. The dev-server binds to a port
 * allocated from the preview pool, listens on `0.0.0.0`, and is served
 * to the browser via the `/preview/$runId/$` proxy route.
 *
 * State (the in-memory map of running previews) is mirrored to
 * `.runtime/preview-runs.json` so a workspace restart can attempt to
 * reconcile already-spawned processes (best-effort: PIDs may be stale).
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeJsonAtomic } from './atomic-write'
import {
  
  HERMES_WORKSPACE_DIR,
  detectFramework
} from './framework-detector'
import { allocatePort, releasePort } from './preview-port-pool'
import { swarmExec, useDockerExec } from './swarm-docker-exec'
import type {DetectedFramework} from './framework-detector';

const HERMES_HOME = process.env.HERMES_HOME || '/opt/data'
const PREVIEW_LOGS_DIR_REMOTE = `${HERMES_HOME}/preview-logs`
const STATE_FILE = join(process.cwd(), '.runtime', 'preview-runs.json')
const HEALTH_CHECK_INTERVAL_MS = 1_000
const HEALTH_CHECK_TIMEOUT_MS = 60_000
const HERMES_AGENT_HOSTNAME = process.env.HERMES_AGENT_HOSTNAME || 'hermes-agent'

export type RunningPreview = {
  runId: string
  projectDir: string
  projectDirRelative: string
  framework: DetectedFramework['framework']
  port: number
  status: 'installing' | 'starting' | 'ready' | 'error' | 'stopped'
  pid?: number
  logsPath: string
  errorMessage?: string
  startedAt: number
  basePath: string
}

type RunStateFile = {
  runs: Record<string, RunningPreview>
}

const runs = new Map<string, RunningPreview>()

function ensureStateDir(): void {
  const dir = dirname(STATE_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function loadState(): void {
  try {
    if (!existsSync(STATE_FILE)) return
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as RunStateFile
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive: disk could hold null/array/primitive
    if (parsed && typeof parsed === 'object' && parsed.runs) {
      for (const [id, run] of Object.entries(parsed.runs)) {
        runs.set(id, run)
      }
    }
  } catch {
    // Corrupt state file — start fresh.
  }
}

function persistState(): void {
  ensureStateDir()
  const obj: RunStateFile = { runs: {} }
  for (const [id, run] of runs) {
    obj.runs[id] = run
  }
  try {
    writeJsonAtomic(STATE_FILE, obj)
  } catch {
    // Non-fatal — in-memory map is still authoritative.
  }
}

loadState()

function newRunId(): string {
  return randomUUID().split('-')[0].toLowerCase()
}

/**
 * Shell-quote a value for safe inclusion inside an `sh -c` script.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function runShellInContainer(
  script: string,
  timeoutMs: number,
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  try {
    const result = await swarmExec('sh', ['-c', script], {
      timeoutMs,
      trim: true,
    })
    return result
  } catch (err) {
    return {
      ok: false,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      code: -1,
    }
  }
}

async function ensureRemoteLogDir(): Promise<void> {
  await runShellInContainer(
    `mkdir -p ${shellQuote(PREVIEW_LOGS_DIR_REMOTE)}`,
    5_000,
  )
}

function buildDevCommand(
  framework: DetectedFramework,
  port: number,
  runId: string,
  projectDir: string,
  logFile: string,
): string {
  const fw = framework.framework
  const basePath = `/preview/${runId}/`
  const cd = `cd ${shellQuote(projectDir)}`
  const redirect = `> ${shellQuote(logFile)} 2>&1`

  if (fw === 'vite') {
    return [
      cd,
      `nohup pnpm dev --port ${port} --host 0.0.0.0 --base ${basePath} ${redirect} &`,
      `echo $!`,
    ].join(' && ')
  }
  if (fw === 'next') {
    return [
      cd,
      `NEXT_BASE_PATH=/preview/${runId} nohup pnpm dev -- --port ${port} --hostname 0.0.0.0 ${redirect} &`,
      `echo $!`,
    ].join(' && ')
  }
  if (fw === 'static') {
    return [
      cd,
      `nohup python3 -m http.server ${port} --bind 0.0.0.0 ${redirect} &`,
      `echo $!`,
    ].join(' && ')
  }
  if (fw === 'astro') {
    return [
      cd,
      `nohup pnpm dev -- --port ${port} --host 0.0.0.0 ${redirect} &`,
      `echo $!`,
    ].join(' && ')
  }
  if (fw === 'sveltekit') {
    return [
      cd,
      `nohup pnpm dev -- --port ${port} --host 0.0.0.0 ${redirect} &`,
      `echo $!`,
    ].join(' && ')
  }
  if (fw === 'cra') {
    return [
      cd,
      `PORT=${port} HOST=0.0.0.0 BROWSER=none nohup pnpm start ${redirect} &`,
      `echo $!`,
    ].join(' && ')
  }
  // unknown — best effort: pnpm dev with --port if the script accepts it.
  return [
    cd,
    `nohup pnpm dev -- --port ${port} --host 0.0.0.0 ${redirect} &`,
    `echo $!`,
  ].join(' && ')
}

async function pollHealth(port: number): Promise<boolean> {
  const target = `http://${HERMES_AGENT_HOSTNAME}:${port}/`
  const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 2_000)
      const res = await fetch(target, {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      // Any HTTP response means the server is up. Vite/Next/Astro all
      // return 200/304/3xx for `/`. Treat <500 as "ready".
      if (res.status > 0 && res.status < 500) {
        return true
      }
    } catch {
      // Not yet listening — wait and retry.
    }
    await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL_MS))
  }
  return false
}

async function killPid(pid: number): Promise<void> {
  await runShellInContainer(`kill ${pid} 2>/dev/null || kill -9 ${pid} 2>/dev/null || true`, 5_000)
}

type StartInput = {
  projectDirRelative: string
  sessionId?: string
}

export async function startPreview(input: StartInput): Promise<RunningPreview> {
  const rel = input.projectDirRelative.replace(/^\/+|\/+$/g, '')
  if (!rel) {
    throw new Error('projectDirRelative required')
  }
  const absoluteProjectDir = join(HERMES_WORKSPACE_DIR, rel)

  // Detect framework. Note: detection runs on the workspace-side fs,
  // which shares /opt/data via volume — so the path is readable here too
  // when running in the VPS-split setup.
  const fw = detectFramework(absoluteProjectDir)
  if (!fw) {
    throw new Error(`No project found at ${absoluteProjectDir}`)
  }

  const runId = newRunId()
  const port = await allocatePort(runId, absoluteProjectDir)
  const logFile = `${PREVIEW_LOGS_DIR_REMOTE}/${runId}.log`

  let preview: RunningPreview = {
    runId,
    projectDir: absoluteProjectDir,
    projectDirRelative: rel,
    framework: fw.framework,
    port,
    status: 'installing',
    logsPath: logFile,
    startedAt: Date.now(),
    basePath: `/preview/${runId}`,
  }
  runs.set(runId, preview)
  persistState()

  await ensureRemoteLogDir()

  // Step 1 — install dependencies (skipped for static sites). We run
  // synchronously and capture stdout/stderr to the log file so the
  // frontend logs viewer can show progress alongside dev-server output.
  if (fw.framework !== 'static') {
    const installScript = [
      `cd ${shellQuote(absoluteProjectDir)}`,
      `pnpm install --prefer-frozen-lockfile > ${shellQuote(logFile)} 2>&1`,
    ].join(' && ')
    const install = await runShellInContainer(installScript, 5 * 60_000)
    if (!install.ok) {
      preview = {
        ...preview,
        status: 'error',
        errorMessage: `pnpm install failed (exit ${install.code}): ${install.stderr.slice(0, 500)}`,
      }
      runs.set(runId, preview)
      persistState()
      try {
        await releasePort(port)
      } catch {
        // best-effort
      }
      throw new Error(preview.errorMessage)
    }
  }

  // Step 2 — spawn the dev server detached.
  preview = { ...preview, status: 'starting' }
  runs.set(runId, preview)
  persistState()

  const devScript = buildDevCommand(fw, port, runId, absoluteProjectDir, logFile)
  // Wrap in `sh -c` and `disown` so the spawned process keeps running
  // after `docker exec` returns.
  const detached = `(${devScript}) ; disown`
  const start = await runShellInContainer(detached, 10_000)
  if (!start.ok) {
    preview = {
      ...preview,
      status: 'error',
      errorMessage: `Failed to spawn dev server: ${start.stderr.slice(0, 500)}`,
    }
    runs.set(runId, preview)
    persistState()
    try {
      await releasePort(port)
    } catch {
      // best-effort
    }
    throw new Error(preview.errorMessage)
  }

  const pid = parseInt(start.stdout.trim().split('\n').pop() || '', 10)
  if (Number.isFinite(pid) && pid > 0) {
    preview = { ...preview, pid }
    runs.set(runId, preview)
    persistState()
  }

  // Step 3 — health check loop (non-blocking from caller's POV would
  // require returning early, but the spec asks to await readiness).
  const ready = await pollHealth(port)
  if (!ready) {
    if (preview.pid) {
      try {
        await killPid(preview.pid)
      } catch {
        // best-effort
      }
    }
    preview = {
      ...preview,
      status: 'error',
      errorMessage: `Dev server did not become ready within ${HEALTH_CHECK_TIMEOUT_MS / 1000}s`,
    }
    runs.set(runId, preview)
    persistState()
    try {
      await releasePort(port)
    } catch {
      // best-effort
    }
    throw new Error(preview.errorMessage)
  }

  preview = { ...preview, status: 'ready' }
  runs.set(runId, preview)
  persistState()
  return preview
}

export async function stopPreview(runId: string): Promise<void> {
  const preview = runs.get(runId)
  if (!preview) return
  if (preview.pid) {
    try {
      await killPid(preview.pid)
    } catch {
      // best-effort
    }
  }
  try {
    await releasePort(preview.port)
  } catch {
    // best-effort
  }
  const updated: RunningPreview = { ...preview, status: 'stopped' }
  runs.set(runId, updated)
  persistState()
}

export async function getPreviewStatus(
  runId: string,
): Promise<RunningPreview | null> {
  return runs.get(runId) ?? null
}

export async function listRunningPreviews(): Promise<Array<RunningPreview>> {
  return Array.from(runs.values()).sort((a, b) => b.startedAt - a.startedAt)
}

export async function getPreviewLogs(
  runId: string,
  tail = 200,
): Promise<string> {
  const preview = runs.get(runId)
  if (!preview) return ''
  const tailLines = Math.max(1, Math.min(5_000, Math.floor(tail)))
  const result = await runShellInContainer(
    `tail -n ${tailLines} ${shellQuote(preview.logsPath)} 2>/dev/null || true`,
    8_000,
  )
  return result.stdout
}

export const _internal = {
  HERMES_AGENT_HOSTNAME,
  PREVIEW_LOGS_DIR_REMOTE,
  STATE_FILE,
  useDockerExec,
}
