import { describe, expect, it } from 'vitest'

import { buildAuthorizedKeysLine, testConnection } from './federation-tunnel'

describe('federation-tunnel — buildAuthorizedKeysLine (Plan F4)', () => {
  it('produces a command="..."-restriction line with no shell access', () => {
    const line = buildAuthorizedKeysLine({
      containerName: 'hermes-agent-zjya-hermes-workspace-1',
      remoteWorkspaceId: 'stratex',
      publicKey: 'ssh-ed25519 AAAA…RealKey == comment',
    })
    expect(line).toContain('command="docker exec -i hermes-agent-zjya-hermes-workspace-1 tsx /app/scripts/mcp-federation-stdio.ts --workspace-id stratex"')
    expect(line).toContain('no-port-forwarding')
    expect(line).toContain('no-X11-forwarding')
    expect(line).toContain('no-agent-forwarding')
    expect(line).toContain('no-pty')
    expect(line.endsWith('ssh-ed25519 AAAA…RealKey == comment')).toBe(true)
  })

  it('honours a custom appPath', () => {
    const line = buildAuthorizedKeysLine({
      containerName: 'foo',
      remoteWorkspaceId: 'planb',
      publicKey: 'ssh-ed25519 X',
      appPath: '/srv/hermes',
    })
    expect(line).toContain('tsx /srv/hermes/scripts/mcp-federation-stdio.ts')
    expect(line).toContain('--workspace-id planb')
  })
})

describe('federation-tunnel — testConnection', () => {
  it('detects an unrestricted SSH key (Plan-Finding F4 negative)', () => {
    // Inject a fake spawn that mimics ssh succeeding with the un-
    // restricted echo we use as a probe.
    const r = testConnection({
      user: 'root', host: 'peer.example', privateKeyPath: '/k',
      spawnImpl: () => ({ status: 0, stdout: '__unrestricted_shell__\n', stderr: '' }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('unrestricted')
      expect(r.details).toMatch(/without a command="/i)
    }
  })

  it('reports ok when ssh returns 0 without echoing the probe (= command="..." enforced)', () => {
    const r = testConnection({
      user: 'root', host: 'peer.example', privateKeyPath: '/k',
      spawnImpl: () => ({ status: 0, stdout: '', stderr: '[mcp-federation-stdio] ready for workspace=stratex' }),
    })
    expect(r.ok).toBe(true)
  })

  it('reports ssh-failed on non-zero exit', () => {
    const r = testConnection({
      user: 'root', host: 'peer.example', privateKeyPath: '/k',
      spawnImpl: () => ({ status: 255, stdout: '', stderr: 'permission denied' }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('ssh-failed')
      expect(r.details).toMatch(/permission denied/)
    }
  })
})
