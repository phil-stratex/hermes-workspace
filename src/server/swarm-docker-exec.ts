/**
 * Swarm docker-exec bridge.
 *
 * In the VPS-split setup the Workspace runs in its own container while
 * Hermes Agent (incl. tmux/hermes binaries + worker profiles) lives in the
 * `hermes-agent` container. The two share the `/opt/data` volume but have
 * isolated process spaces. The swarm-tmux-* routes need to exec tmux/hermes
 * inside the agent container — this helper centralises that.
 *
 * Activation: set HERMES_VPS_CONTAINER=<container-name> in the Workspace
 * environment. When unset the helper acts as a passthrough (legacy local
 * behaviour) so the unmodified upstream codepath still works.
 */

import { spawn } from 'node:child_process'

export const HERMES_VPS_CONTAINER = process.env.HERMES_VPS_CONTAINER ?? ''

export function useDockerExec(): boolean {
  return HERMES_VPS_CONTAINER.length > 0
}

export type SwarmExecResult = {
  ok: boolean
  stdout: string
  stderr: string
  code: number
}

/**
 * Run a command — locally if HERMES_VPS_CONTAINER is unset, or via
 * `docker exec <container> <cmd> <args...>` otherwise.
 *
 * `opts.container` overrides the default container (B6: per-worker
 * containers for multi-instance swarms).
 */
export function swarmExec(
  cmd: string,
  args: ReadonlyArray<string>,
  opts: {
    timeoutMs?: number
    env?: NodeJS.ProcessEnv
    container?: string
    /** Optional stdin payload (used for `tmux load-buffer -`, etc.) */
    input?: string
    /** Trim trailing whitespace on stdout/stderr (default true). */
    trim?: boolean
  } = {},
): Promise<SwarmExecResult> {
  return new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs ?? 10_000
    const containerName = opts.container || HERMES_VPS_CONTAINER
    const dockerMode = containerName.length > 0
    const finalCmd = dockerMode ? 'docker' : cmd
    const dockerEnvArgs: Array<string> = []
    if (dockerMode && opts.env) {
      for (const [k, v] of Object.entries(opts.env)) {
        if (typeof v === 'string') dockerEnvArgs.push('-e', `${k}=${v}`)
      }
    }
    const finalArgs = dockerMode
      ? opts.input != null
        ? ['exec', '-i', ...dockerEnvArgs, containerName, cmd, ...args]
        : ['exec', ...dockerEnvArgs, containerName, cmd, ...args]
      : Array.from(args)
    const proc = spawn(finalCmd, finalArgs, {
      stdio: [opts.input != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: opts.env ?? process.env,
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    if (opts.input != null && proc.stdin) {
      proc.stdin.end(opts.input)
    }
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
    }, timeoutMs)
    proc.on('close', (code) => {
      clearTimeout(timer)
      const trim = opts.trim !== false
      resolve({
        ok: code === 0,
        stdout: trim ? stdout.trim() : stdout,
        stderr: trim ? stderr.trim() : stderr,
        code: code ?? -1,
      })
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        ok: false,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        code: -1,
      })
    })
  })
}

/**
 * Profiles live on the shared volume. From inside both containers they are
 * at `/opt/data/profiles/<workerId>` (HERMES_HOME=/opt/data + profiles/).
 */
export const VPS_PROFILES_DIR = '/opt/data/profiles'

/**
 * Bootstrap a worker profile dir with a minimal config.yaml derived from
 * the global one. Idempotent — does nothing if the profile already exists.
 */
export async function ensureWorkerProfile(
  workerId: string,
  modelOverride?: { provider: string; default: string },
  container?: string,
): Promise<SwarmExecResult> {
  if (!useDockerExec() && !container) {
    return { ok: true, stdout: 'skipped (local mode)', stderr: '', code: 0 }
  }
  const profilePath = `${VPS_PROFILES_DIR}/${workerId}`
  const script = [
    `set -e`,
    `mkdir -p '${profilePath}'`,
    // Copy global config as starting point if no config yet.
    `[ -f '${profilePath}/config.yaml' ] || cp /opt/data/config.yaml '${profilePath}/config.yaml'`,
    // Per-worker .env (inherits OLLAMA_API_KEY for now).
    `[ -f '${profilePath}/.env' ] || cp /opt/data/.env '${profilePath}/.env' 2>/dev/null || true`,
    // sessions/skills/memories dirs.
    `mkdir -p '${profilePath}/sessions' '${profilePath}/memories' '${profilePath}/skills'`,
    modelOverride
      ? `python3 -c "
import re
p='${profilePath}/config.yaml'
t=open(p).read()
t=re.sub(r'^(model:\\n  default: ).+', lambda m: m.group(1)+'${modelOverride.default}', t, count=1, flags=re.M)
t=re.sub(r'^(model:\\n  default: .+\\n  provider: ).+', lambda m: m.group(1)+'${modelOverride.provider}', t, count=1, flags=re.M)
open(p,'w').write(t)"`
      : ``,
  ]
    .filter(Boolean)
    .join(' && ')
  return swarmExec('sh', ['-c', script], { timeoutMs: 8_000, container })
}
