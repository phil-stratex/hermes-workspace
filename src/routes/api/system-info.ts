/**
 * System-Info — read-only diagnostic surface for the workspace's VPS-mode
 * configuration. Exposes which container the docker-exec bridge talks to,
 * which Hermes/Dashboard URLs are configured, whether the workspace-context
 * tag injection is enabled, etc.
 *
 * Designed for the Usage page so the user can quickly verify the setup
 * without SSH-ing into the VPS.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuthenticated } from '../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { swarmExec, useDockerExec } from '../../server/swarm-docker-exec'

export const Route = createFileRoute('/api/system-info')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireAuthenticated(request)
        if (!auth.ok) return auth.response

        const env = {
          HERMES_HOME: process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes'),
          HERMES_API_URL: process.env.HERMES_API_URL ?? '(unset)',
          HERMES_DASHBOARD_URL: process.env.HERMES_DASHBOARD_URL ?? '(unset)',
          HERMES_VPS_CONTAINER: process.env.HERMES_VPS_CONTAINER ?? '(unset)',
          HERMES_INJECT_WORKSPACE_CONTEXT:
            process.env.HERMES_INJECT_WORKSPACE_CONTEXT ?? '0',
          HERMES_WORKSPACE_DIR:
            process.env.HERMES_WORKSPACE_DIR ?? '(unset)',
        }

        // Sanity-checks against the shared volume.
        const volumes: Array<{ path: string; exists: boolean }> = []
        for (const p of [
          env.HERMES_HOME,
          path.join(env.HERMES_HOME, 'config.yaml'),
          path.join(env.HERMES_HOME, 'models.json'),
          path.join(env.HERMES_HOME, 'switch-model-internal.sh'),
          path.join(env.HERMES_HOME, 'session-titles.json'),
          path.join(env.HERMES_HOME, 'council', 'sessions'),
        ]) {
          volumes.push({ path: p, exists: fs.existsSync(p) })
        }

        // Try a docker-exec ping to confirm the bridge actually works.
        let dockerBridge: {
          configured: boolean
          ok: boolean
          stderr?: string
          tmuxAvailable?: boolean
        } = {
          configured: useDockerExec(),
          ok: false,
        }
        if (useDockerExec()) {
          const ping = await swarmExec('echo', ['ok'], { timeoutMs: 4_000 })
          dockerBridge.ok = ping.ok && ping.stdout === 'ok'
          if (!dockerBridge.ok) dockerBridge.stderr = ping.stderr
          if (dockerBridge.ok) {
            const tmuxCheck = await swarmExec('which', ['tmux'], { timeoutMs: 3_000 })
            dockerBridge.tmuxAvailable = tmuxCheck.ok && tmuxCheck.stdout.length > 0
          }
        }

        return json({
          ok: true,
          generatedAt: Date.now(),
          env,
          volumes,
          dockerBridge,
        })
      },
    },
  },
})
