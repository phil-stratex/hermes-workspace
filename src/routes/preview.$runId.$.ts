/**
 * Preview Sub-Path Proxy.
 *
 * Forwards every request under `/preview/<runId>/<...rest>` to the
 * matching dev-server running inside the hermes-agent container at
 * `http://hermes-agent:<port>/<...rest>`. The frontend Iframe points at
 * `/preview/<runId>/` and sees the live app — Vite/Next/etc. is told via
 * `--base /preview/<runId>/` (vite) or `NEXT_BASE_PATH` (next) to emit
 * sub-path-correct asset URLs so resources resolve through this proxy.
 *
 * --- Design choices ---------------------------------------------------
 *
 * Streaming pass-through. We forward `request.body` directly without
 * re-decoding so multipart uploads / large POSTs stay intact. Response
 * body is also streamed via `new Response(upstream.body, …)` so SSE and
 * chunked transfers arrive in real time.
 *
 * Hop-by-hop header stripping. Per RFC 7230 §6.1, headers like
 * `connection`, `keep-alive`, `transfer-encoding`, `te`, `trailer`,
 * `proxy-authorization`, and `upgrade` belong to a single hop and must
 * not be forwarded. `host` is also stripped so undici can set the
 * correct upstream Host.
 *
 * --- Known limitations ------------------------------------------------
 *
 * 1. WebSocket / HMR upgrade is NOT supported. Vite/Next dev-servers
 *    use a WebSocket for hot module reload; the TanStack Start route
 *    handler runs over plain HTTP and cannot perform an HTTP→WS
 *    upgrade. For Phase 2 MVP, accept that HMR is broken — users have
 *    to manually reload the iframe to see code changes. Solving this
 *    requires a raw TCP/HTTP upgrade-aware proxy at a lower layer
 *    (`http-proxy` middleware or the Vite server itself).
 *
 * 2. Asset paths. Vite is told `--base /preview/<runId>/` so it
 *    generates `/preview/<runId>/assets/foo.js` URLs which round-trip
 *    through this proxy correctly. Next.js requires the project to
 *    declare `basePath` in `next.config.js`; the env-var
 *    `NEXT_BASE_PATH` is read by the project's own config (see
 *    `project-runner.ts`). Astro / SvelteKit / CRA do not support
 *    sub-path bases out-of-box and will emit absolute `/assets/...`
 *    URLs that fail through the proxy — those frameworks need a
 *    config change in the generated project for full asset support.
 *    For Phase 2 we accept that behaviour and document it here.
 *
 * 3. Cross-origin / cookies. The proxy does not rewrite Set-Cookie
 *    domains. Cookies set by the upstream dev-server will land on the
 *    workspace origin which is generally what we want for the iframe.
 *
 * 4. Trailing-slash handling. Browsers may request `/preview/<runId>`
 *    without a trailing slash; the catch-all matches but the upstream
 *    receives `GET /` which is correct. Index requests work either way.
 */

import { createFileRoute } from '@tanstack/react-router'
import { listRunningPreviews } from '../server/project-runner'

const HERMES_AGENT_HOSTNAME = process.env.HERMES_AGENT_HOSTNAME || 'hermes-agent'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
])

function stripHopHeaders(source: Headers): Headers {
  const out = new Headers()
  for (const [key, value] of source) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      out.set(key, value)
    }
  }
  return out
}

async function proxyToPreview(
  request: Request,
  params: { runId: string; _splat?: string },
): Promise<Response> {
  const runId = params.runId
  const tail = params._splat || ''

  const runs = await listRunningPreviews()
  const run = runs.find((r) => r.runId === runId && r.status === 'ready')
  if (!run) {
    return new Response('Preview not running', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  const incoming = new URL(request.url)
  const targetUrl = `http://${HERMES_AGENT_HOSTNAME}:${run.port}/${tail}${incoming.search}`

  const headers = stripHopHeaders(request.headers)
  // Override host so the upstream sees the right authority. undici will
  // set this automatically if absent — be explicit for clarity.
  headers.set('host', `${HERMES_AGENT_HOSTNAME}:${run.port}`)

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    redirect: 'manual',
  }
  if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    init.body = request.body
    init.duplex = 'half'
  }

  let upstream: Response
  try {
    upstream = await fetch(targetUrl, init)
  } catch (err) {
    return new Response(
      `preview upstream unreachable: ${err instanceof Error ? err.message : String(err)}`,
      {
        status: 502,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      },
    )
  }

  const responseHeaders = stripHopHeaders(upstream.headers)
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  })
}

export const Route = createFileRoute('/preview/$runId/$')({
  server: {
    handlers: {
      GET: async ({ request, params }) => proxyToPreview(request, params),
      POST: async ({ request, params }) => proxyToPreview(request, params),
      PUT: async ({ request, params }) => proxyToPreview(request, params),
      DELETE: async ({ request, params }) => proxyToPreview(request, params),
      PATCH: async ({ request, params }) => proxyToPreview(request, params),
      OPTIONS: async ({ request, params }) => proxyToPreview(request, params),
    },
  },
})
