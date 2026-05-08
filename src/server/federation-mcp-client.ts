/**
 * Federation MCP client (Plan B Phase B.1).
 *
 * Speaks the same newline-delimited JSON-RPC 2.0 over stdio that the
 * server (`scripts/mcp-federation-stdio.ts`) speaks. The transport
 * is `ssh` invoked as a child process with the peer's pinned
 * `command="..."` SSH key — see `federation-tunnel.ts`. We don't
 * keep a long-lived ssh2 channel here because the per-request
 * overhead of spawning ssh once and pipelining JSON-RPC calls is
 * easier to reason about than maintaining a connection-pool.
 *
 * Sync sessions are short-lived (Plan B "TTL 15 min"), so the
 * client maintains one `Connection` instance per `(wsId, peerId)`
 * pair, batches the seven Phase-B-1 tool calls in order, and tears
 * the underlying ssh process down on close.
 */

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type { ToolName } from './federation-mcp-server'

export type ConnectionConfig = {
  /** SSH user to authenticate as on the peer host. */
  user: string
  host: string
  port?: number
  /** Local file path of the private key. */
  privateKeyPath: string
  /** Spawned-process timeout — defaults to 15 min like the spec's tunnel TTL. */
  timeoutMs?: number
  /**
   * Override the underlying transport for tests. When set, this
   * function is invoked instead of `spawn('ssh', …)` and its return
   * value used as the live process. Lets unit tests pipe through a
   * local handler without booting ssh.
   */
  spawnImpl?: (config: ConnectionConfig) => ChildProcessWithoutNullStreams
}

export type RpcOk<T> = { ok: true; result: T }
export type RpcErr = { ok: false; error: { code: number; message: string; data?: unknown } }
export type RpcResponse<T> = RpcOk<T> | RpcErr

export class FederationMcpClient {
  private proc: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private pending = new Map<
    number,
    {
      resolve: (r: RpcResponse<unknown>) => void
      reject: (e: Error) => void
    }
  >()
  private buffer = ''
  private closed = false

  constructor(private readonly config: ConnectionConfig) {}

  open(): void {
    if (this.proc) return
    this.proc = this.config.spawnImpl
      ? this.config.spawnImpl(this.config)
      : spawn(
          'ssh',
          [
            '-i',
            this.config.privateKeyPath,
            '-o',
            'BatchMode=yes',
            '-o',
            'StrictHostKeyChecking=accept-new',
            '-p',
            String(this.config.port ?? 22),
            `${this.config.user}@${this.config.host}`,
          ],
          { stdio: ['pipe', 'pipe', 'pipe'] },
        )
    if (!this.proc.stdout) throw new Error('[federation-mcp-client] ssh process has no stdout')
    if (!this.proc.stdin) throw new Error('[federation-mcp-client] ssh process has no stdin')
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk: string) => this.handleStdout(chunk))
    this.proc.on('exit', () => {
      this.closed = true
      for (const p of this.pending.values()) {
        p.reject(new Error('ssh process exited before response'))
      }
      this.pending.clear()
    })
  }

  async call<T>(method: ToolName, params: Record<string, unknown> = {}): Promise<RpcResponse<T>> {
    if (!this.proc) this.open()
    if (this.closed) throw new Error('[federation-mcp-client] connection already closed')
    const id = this.nextId++
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
    return new Promise<RpcResponse<T>>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (r: RpcResponse<unknown>) => void,
        reject,
      })
      const stdin = this.proc!.stdin
      if (!stdin) {
        reject(new Error('ssh stdin closed'))
        return
      }
      stdin.write(frame)
      const ttl = this.config.timeoutMs ?? 15 * 60 * 1000
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`[federation-mcp-client] timeout (${ttl}ms) for ${method}`))
        }
      }, ttl)
    })
  }

  close(): void {
    if (this.proc) {
      try {
        this.proc.stdin?.end()
        this.proc.kill()
      } catch {
        // best-effort
      }
      this.proc = null
    }
    this.closed = true
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk
    while (true) {
      const newline = this.buffer.indexOf('\n')
      if (newline === -1) return
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line.length === 0) continue
      let parsed: { id?: number | string | null; result?: unknown; error?: { code: number; message: string; data?: unknown } }
      try {
        parsed = JSON.parse(line) as typeof parsed
      } catch {
        continue
      }
      if (typeof parsed.id !== 'number') continue
      const pending = this.pending.get(parsed.id)
      if (!pending) continue
      this.pending.delete(parsed.id)
      if (parsed.error) {
        pending.resolve({ ok: false, error: parsed.error })
      } else {
        pending.resolve({ ok: true, result: parsed.result })
      }
    }
  }
}
