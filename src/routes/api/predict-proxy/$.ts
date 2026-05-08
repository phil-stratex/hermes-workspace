import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'

/**
 * Splat-proxy that forwards every `/api/predict-proxy/<path>` request to
 * the stratex-predict-api sibling container.
 *
 * The bearer token (PREDICT_API_TOKEN) is injected server-side so the
 * browser never sees it. Method, query string, and body pass through
 * unchanged. SSE responses are streamed without buffering so live
 * progress events arrive in real time.
 *
 * Origin URL is read at request time (not module-load) so a config
 * change picks up on the next request without a workspace restart.
 */

const PREDICT_PROXY_HEADER_BLOCKLIST = new Set([
  'host',
  'connection',
  'content-length',
  // The browser sets Authorization in some flows — never forward it.
  'authorization',
])

function predictBaseUrl(): string {
  return (
    process.env.PREDICT_API_URL ||
    process.env.STRATEX_PREDICT_API_URL ||
    'http://stratex-predict-api:5101'
  )
}

function predictBearer(): string {
  return process.env.PREDICT_API_TOKEN || process.env.STRATEX_PREDICT_API_TOKEN || ''
}

async function proxyRequest(request: Request, splat: string): Promise<Response> {
  const incoming = new URL(request.url)
  const targetPath = splat.startsWith('/') ? splat : `/${splat}`
  const target = new URL(`${predictBaseUrl().replace(/\/$/, '')}${targetPath}`)
  target.search = incoming.search

  const headers = new Headers()
  for (const [key, value] of request.headers) {
    if (!PREDICT_PROXY_HEADER_BLOCKLIST.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  }
  const bearer = predictBearer()
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`)

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  }
  if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    // Forward the raw body without re-decoding so multipart uploads stay intact.
    init.body = request.body
    // node:undici needs this when streaming a request body.
    ;(init as RequestInit & { duplex?: string }).duplex = 'half'
  }

  let upstream: Response
  try {
    upstream = await fetch(target, init)
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'predict-api unreachable',
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    )
  }

  // Stream-through for SSE / chunked responses.
  const responseHeaders = new Headers()
  const contentType = upstream.headers.get('content-type') || ''
  if (contentType) responseHeaders.set('content-type', contentType)
  const cacheControl = upstream.headers.get('cache-control')
  if (cacheControl) responseHeaders.set('cache-control', cacheControl)

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  })
}

export const Route = createFileRoute('/api/predict-proxy/$')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })
        }
        return proxyRequest(request, params._splat || '')
      },
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })
        }
        return proxyRequest(request, params._splat || '')
      },
      PUT: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })
        }
        return proxyRequest(request, params._splat || '')
      },
      PATCH: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })
        }
        return proxyRequest(request, params._splat || '')
      },
      DELETE: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })
        }
        return proxyRequest(request, params._splat || '')
      },
    },
  },
})
