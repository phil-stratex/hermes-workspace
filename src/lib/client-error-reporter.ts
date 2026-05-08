/**
 * Browser-side error capture. Two listeners + a fetch wrapper post to
 * `/api/errors/client` so React-render-errors aren't the only thing we
 * see — uncaught throws, rejected promises and failing fetches all
 * land in the same JSONL store as backend errors.
 *
 * Rate-limit: a token-bucket of 10 reports per 60 s per tab. The 11th
 * Error in 60 s gets dropped client-side with a console.warn — protects
 * the backend from a render-loop DoSing the logger.
 *
 * Production-mode hardening: in `import.meta.env.DEV`, the local
 * console gets the full stack as usual. In production, console output
 * is suppressed (only the report-id is logged, mirroring the
 * ErrorBoundary fallback).
 */

const POST_URL = '/api/errors/client'
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 10

let bucket: Array<number> = []
function rateAllow(): boolean {
  const now = Date.now()
  bucket = bucket.filter((t) => now - t < RATE_WINDOW_MS)
  if (bucket.length >= RATE_MAX) return false
  bucket.push(now)
  return true
}

type ReportInput = {
  message: string
  stack?: string
  level?: 'fatal' | 'error' | 'warn'
  context?: Record<string, unknown>
}

function browserInfo() {
  if (typeof window === 'undefined') return undefined
  return {
    userAgent: navigator.userAgent,
    url: window.location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  }
}

let reporting = false
async function send(input: ReportInput): Promise<{ id: string } | null> {
  if (!rateAllow()) {
    if (import.meta.env.DEV) {
      console.warn('[error-reporter] rate-limited (>10/min). Dropping:', input.message)
    }
    return null
  }
  if (reporting) return null // avoid recursion if our own fetch errors
  reporting = true
  try {
    const res = await fetch(POST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: input.message,
        stack: input.stack,
        level: input.level ?? 'error',
        context: input.context,
        browser: browserInfo(),
      }),
      // Don't keep the page open just because a logger request lingers.
      keepalive: true,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { ok: boolean; id?: string }
    return json.id ? { id: json.id } : null
  } catch {
    return null
  } finally {
    reporting = false
  }
}

/** Exposed so the React Error-Boundary can call us directly. */
export function reportClientError(input: ReportInput): Promise<{ id: string } | null> {
  return send(input)
}

/**
 * fetch-wrapper that reports network failures (not HTTP-error responses,
 * which the caller likely handles intentionally — only thrown errors).
 * Use it for non-critical client calls; critical paths can still call
 * fetch directly and report manually.
 */
export async function trackedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (err) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    void send({
      message: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      stack: err instanceof Error ? err.stack : undefined,
      context: { url, method: init?.method ?? 'GET' },
    })
    throw err
  }
}

let installed = false

/**
 * Wires `window.error` and `window.unhandledrejection` to the reporter.
 * Idempotent — safe to call multiple times during HMR. Returns a
 * teardown for tests.
 */
export function installClientErrorReporter(): () => void {
  if (typeof window === 'undefined') return () => {}
  if (installed) return () => {}
  installed = true

  const onError = (ev: ErrorEvent): void => {
    const msg = ev.message || 'window.error'
    const stack = ev.error instanceof Error ? ev.error.stack : undefined
    void send({ message: msg, stack, context: { filename: ev.filename, lineno: ev.lineno } })
  }
  const onRejection = (ev: PromiseRejectionEvent): void => {
    const reason = ev.reason
    const msg =
      reason instanceof Error
        ? `unhandled rejection: ${reason.message}`
        : `unhandled rejection: ${String(reason)}`
    const stack = reason instanceof Error ? reason.stack : undefined
    void send({ message: msg, stack })
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    installed = false
  }
}

/** Test-only: clear the rate-limit bucket between cases. */
export function _resetRateLimitForTests(): void {
  bucket = []
}
