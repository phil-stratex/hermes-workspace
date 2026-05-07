import { spawn } from 'node:child_process'
import { json } from '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'

const ALLOWED_MODELS = new Set([
  'kimi-k2.6',
  'deepseek-v4-pro',
  'qwen3.5:397b',
  'qwen3-coder:480b',
  'glm-5.1',
  'deepseek-v4-flash',
])

const SSH_TARGET = process.env.HERMES_VPS_SSH ?? 'root@72.62.50.32'
const REMOTE_SCRIPT =
  process.env.HERMES_VPS_SWITCH_SCRIPT ??
  '/docker/hermes-agent-zjya/switch-model.sh'

function runSwitchScript(
  model: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        SSH_TARGET,
        REMOTE_SCRIPT,
        model,
      ],
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
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
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
