import { spawn } from 'node:child_process'
import { json } from '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { requireWorkspaceAction } from '../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { OLLAMA_CLOUD_IDS } from '../../server/ollama-cloud-models'
import { requireJsonContentType } from '../../server/rate-limit'
import { swarmExec, useDockerExec } from '../../server/swarm-docker-exec'

const ALLOWED_MODELS = new Set<string>(OLLAMA_CLOUD_IDS)

const IN_CONTAINER_SCRIPT =
  process.env.HERMES_SWITCH_SCRIPT ?? '/opt/data/switch-model-internal.sh'

async function runSwitchScript(
  model: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  // VPS-split topology: docker exec into hermes-agent container via the
  // mounted /var/run/docker.sock. The workspace image (node:22-alpine) has
  // no ssh client, so SSH-based invocation fails with spawn-error ENOENT.
  if (useDockerExec()) {
    const r = await swarmExec(IN_CONTAINER_SCRIPT, [model], {
      timeoutMs: 30_000,
    })
    return { code: r.code, stdout: r.stdout, stderr: r.stderr }
  }
  // Local-dev fallback: invoke the script directly in PATH (or whatever
  // HERMES_LOCAL_SWITCH_SCRIPT points at).
  return new Promise((resolve) => {
    const proc = spawn(
      process.env.HERMES_LOCAL_SWITCH_SCRIPT ?? 'switch-model.sh',
      [model],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    proc.on('close', (code) =>
      resolve({ code: code ?? -1, stdout, stderr }),
    )
    proc.on('error', () => resolve({ code: -1, stdout, stderr: 'spawn-error' }))
  })
}

export const Route = createFileRoute('/api/switch-model')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = requireWorkspaceAction(request, 'roster-edit')
        if (!guard.ok) return guard.response
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
        }
        const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
        const raw = typeof rec.model === 'string' ? rec.model.trim() : ''
        const model = raw.includes('/') ? raw.split('/').slice(1).join('/') : raw
        if (!model || !ALLOWED_MODELS.has(model)) {
          return json(
            { ok: false, error: `Model not allowed: ${raw}` },
            { status: 400 },
          )
        }
        const result = await runSwitchScript(model)
        if (result.code !== 0) {
          return json(
            {
              ok: false,
              error: result.stderr.trim() || result.stdout.trim() || 'switch-failed',
              code: result.code,
            },
            { status: 500 },
          )
        }
        return json({ ok: true, model, output: result.stdout.trim() })
      },
    },
  },
})
