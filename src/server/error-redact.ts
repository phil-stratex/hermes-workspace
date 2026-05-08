/**
 * Auto-redaction for log / error entries before they're persisted.
 *
 * Every value reaching the JSONL store goes through `redact()`. Without
 * this a single `logger.warn('login failed', request.headers)` would
 * leak Cookie / Authorization / API-Key into the on-disk log — exactly
 * the kind of leak that makes a "shareable error log" untenable.
 *
 * Strategy:
 *   - Recognised key names ("password", "token", ...) → value redacted, name kept
 *   - Recognised auth headers (cookie, authorization, ...) → value redacted
 *   - String value matches token-pattern (32+ alnum chars) → flagged
 *   - String value matches JWT / bcrypt / Postgres-DSN → flagged
 *   - Email in stack-trace strings → ***@***.***
 *   - Stack > 8 KB → keep top 4 KB + bottom 4 KB
 *   - Body > 4 KB → keep first 4 KB + truncation marker
 *   - Recursion (N4): depth > MAX_DEPTH → '[OBJECT_TOO_DEEP]'
 *   - Circular refs (N4): WeakSet-tracked → '[CIRCULAR]'
 *
 * Pure function — same input always produces same output. No I/O,
 * no env reads. Lets the test suite assert exact strings.
 */

const MAX_DEPTH = 10
const MAX_BODY_BYTES = 4 * 1024
const STACK_HEAD_BYTES = 4 * 1024
const STACK_TAIL_BYTES = 4 * 1024
const STACK_TRUNCATE_THRESHOLD = STACK_HEAD_BYTES + STACK_TAIL_BYTES

const SENSITIVE_KEY_RE = /(?:password|token|secret|api[-_]?key|hash|bcrypt|private)/i
const SENSITIVE_HEADER_RE = /^(?:cookie|authorization|x-api-key|x-hermes-api-token)$/i

const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
const BCRYPT_RE = /\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}/g
const POSTGRES_DSN_RE = /postgres(?:ql)?:\/\/[^\s]+/gi
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g

const REDACTED = '[REDACTED]'
const POSSIBLE_TOKEN = '[POSSIBLE_TOKEN_REDACTED]'
const TOO_DEEP = '[OBJECT_TOO_DEEP]'
const CIRCULAR = '[CIRCULAR]'

export type RedactOptions = {
  /** True for Error.stack inputs — enables email scrub + stack truncation. */
  isStack?: boolean
}

/**
 * Recursively redact a value of any shape. Safe against:
 *   - circular refs (WeakSet)
 *   - deep trees (depth limit, returns '[OBJECT_TOO_DEEP]')
 *   - large strings (truncated)
 *
 * The function does NOT mutate the input — every object is rebuilt.
 */
export function redact(value: unknown, opts: RedactOptions = {}): unknown {
  return redactInternal(value, 0, new WeakSet<object>(), opts)
}

/** Convenience wrapper for stack-strings (sets `isStack: true`). */
export function redactStack(stack: string | undefined): string | undefined {
  if (typeof stack !== 'string') return undefined
  return redact(stack, { isStack: true }) as string
}

function redactInternal(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  opts: RedactOptions,
): unknown {
  if (depth > MAX_DEPTH) return TOO_DEEP

  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    const redacted = redactString(value, opts.isStack === true)
    return opts.isStack === true ? truncateStack(redacted) : truncateBody(redacted)
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value
  }
  if (typeof value === 'function') {
    return '[FUNCTION]'
  }
  if (typeof value === 'symbol') {
    return value.toString()
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return CIRCULAR
    seen.add(value)
    return value.map((v) => redactInternal(v, depth + 1, seen, opts))
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return CIRCULAR
    seen.add(value)
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k) || SENSITIVE_HEADER_RE.test(k)) {
        out[k] = REDACTED
      } else {
        out[k] = redactInternal(v, depth + 1, seen, opts)
      }
    }
    return out
  }

  return String(value)
}

function redactString(value: string, contextIsStack: boolean): string {
  let out = value
  out = out.replace(JWT_RE, REDACTED)
  out = out.replace(BCRYPT_RE, REDACTED)
  out = out.replace(POSTGRES_DSN_RE, REDACTED)
  if (contextIsStack) {
    out = out.replace(EMAIL_RE, '***@***.***')
  }
  out = out.replace(TOKEN_RE, POSSIBLE_TOKEN)
  return out
}

function truncateBody(s: string): string {
  const bytes = Buffer.byteLength(s, 'utf8')
  if (bytes <= MAX_BODY_BYTES) return s
  return `${s.slice(0, MAX_BODY_BYTES)}[TRUNCATED ${MAX_BODY_BYTES}/${bytes}]`
}

function truncateStack(s: string): string {
  const bytes = Buffer.byteLength(s, 'utf8')
  if (bytes <= STACK_TRUNCATE_THRESHOLD) return s
  const head = s.slice(0, STACK_HEAD_BYTES)
  const tail = s.slice(-STACK_TAIL_BYTES)
  return `${head}\n[STACK TRUNCATED ${bytes - STACK_TRUNCATE_THRESHOLD} bytes elided]\n${tail}`
}
