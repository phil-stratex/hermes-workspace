import { describe, expect, it } from 'vitest'

import { redact, redactStack } from './error-redact'

describe('error-redact', () => {
  describe('header redaction', () => {
    it('redacts cookie header value', () => {
      expect(redact({ cookie: 'session=abcdef' })).toEqual({ cookie: '[REDACTED]' })
    })
    it('redacts Authorization header (case-insensitive on key)', () => {
      expect(redact({ Authorization: 'Bearer xyz' })).toEqual({ Authorization: '[REDACTED]' })
    })
    it('redacts x-api-key', () => {
      expect(redact({ 'x-api-key': 'sk_test_aaa' })).toEqual({ 'x-api-key': '[REDACTED]' })
    })
    it('redacts x-hermes-api-token', () => {
      expect(redact({ 'x-hermes-api-token': 'abc' })).toEqual({
        'x-hermes-api-token': '[REDACTED]',
      })
    })
  })

  describe('field-name redaction', () => {
    it('redacts password field', () => {
      expect(redact({ user: 'phil', password: 'secret123' })).toEqual({
        user: 'phil',
        password: '[REDACTED]',
      })
    })
    it('redacts token / apiKey / api_key fields', () => {
      expect(redact({ token: 'a', apiKey: 'b', api_key: 'c' })).toEqual({
        token: '[REDACTED]',
        apiKey: '[REDACTED]',
        api_key: '[REDACTED]',
      })
    })
    it('redacts secret / hash / bcrypt / private fields', () => {
      expect(
        redact({ secret: 'a', hash: 'b', bcrypt: 'c', private: 'd' }),
      ).toEqual({
        secret: '[REDACTED]',
        hash: '[REDACTED]',
        bcrypt: '[REDACTED]',
        private: '[REDACTED]',
      })
    })
    it('keeps non-sensitive fields intact', () => {
      expect(redact({ user: 'phil', age: 30 })).toEqual({ user: 'phil', age: 30 })
    })
    it('redacts inside nested objects', () => {
      expect(redact({ outer: { password: 'secret' } })).toEqual({
        outer: { password: '[REDACTED]' },
      })
    })
  })

  describe('value-pattern redaction', () => {
    it('redacts JWT pattern', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJBQkNERUZHSElKS0w.abcdefghijKLMNOP'
      const out = redact({ blob: jwt }) as { blob: string }
      expect(out.blob).toContain('[REDACTED]')
      expect(out.blob).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    })
    it('redacts bcrypt hash pattern', () => {
      const b = '$2b$12$KIXEVGzCcGmVxgBFFQWpGOTtGzvYzL5BV2wSDAVwGhg3qZMHHbQRG'
      const out = redact({ blob: b }) as { blob: string }
      expect(out.blob).toBe('[REDACTED]')
    })
    it('redacts Postgres DSN', () => {
      const out = redact({ blob: 'connect to postgres://u:p@host:5432/db now' }) as {
        blob: string
      }
      expect(out.blob).toContain('[REDACTED]')
      expect(out.blob).not.toContain('postgres://')
    })
    it('flags 32+-char alnum tokens', () => {
      const out = redact({ blob: 'a'.repeat(40) }) as { blob: string }
      expect(out.blob).toBe('[POSSIBLE_TOKEN_REDACTED]')
    })
    it('does NOT flag short strings', () => {
      expect(redact({ blob: 'short' })).toEqual({ blob: 'short' })
    })
  })

  describe('stack mode', () => {
    it('scrubs email in stack', () => {
      const stack = '    at fn (file.js:1)\n    user=phil@stratex-ai.com'
      const out = redactStack(stack) as string
      expect(out).toContain('***@***.***')
      expect(out).not.toContain('phil@stratex-ai.com')
    })
    it('does not scrub email outside of stack mode', () => {
      const out = redact({ email: 'phil@stratex-ai.com' }) as { email: string }
      expect(out.email).toBe('phil@stratex-ai.com')
    })
    it('truncates very long stack', () => {
      // Realistic frame line so TOKEN_RE (32+ alnum) can't swallow the
      // whole input — punctuation/spaces split it into short tokens.
      const frame = '    at handlerFn (/srv/app/route.ts:123:45)\n'
      const big = frame.repeat(300) // ~12 KB — well over 8 KB threshold
      const out = redactStack(big) as string
      expect(out).toContain('[STACK TRUNCATED')
      expect(out.length).toBeLessThan(big.length)
    })
  })

  describe('body truncation', () => {
    it('truncates string > 4 KB', () => {
      // Realistic JSON-like content so TOKEN_RE doesn't collapse the
      // whole thing into a single [POSSIBLE_TOKEN_REDACTED] before
      // length-based truncation kicks in.
      const chunk = '{"k":"v","n":42,"flag":true}, '
      const big = chunk.repeat(200) // ~6 KB
      const out = redact(big) as string
      expect(out).toContain('[TRUNCATED 4096/')
    })
    it('keeps small strings intact', () => {
      expect(redact('hello')).toBe('hello')
    })
    it('a long all-alnum blob gets POSSIBLE_TOKEN_REDACTED before truncation (security wins over visibility)', () => {
      const big = 'a'.repeat(5 * 1024)
      const out = redact(big) as string
      expect(out).toBe('[POSSIBLE_TOKEN_REDACTED]')
    })
  })

  describe('recursion safety (N4)', () => {
    it('caps deep trees at depth 10 with [OBJECT_TOO_DEEP]', () => {
      type Node = { next?: Node }
      const root: Node = {}
      let cur = root
      for (let i = 0; i < 20; i++) {
        cur.next = {}
        cur = cur.next
      }
      const out = redact(root) as Record<string, unknown>
      // Walk down looking for the marker
      let n: unknown = out
      let found = false
      for (let i = 0; i < 25; i++) {
        if (n === '[OBJECT_TOO_DEEP]') {
          found = true
          break
        }
        if (typeof n !== 'object' || n === null) break
        n = (n as Record<string, unknown>).next
      }
      expect(found).toBe(true)
    })

    it('handles direct circular references', () => {
      type Node = { name: string; self?: unknown }
      const a: Node = { name: 'a' }
      a.self = a
      const out = redact(a) as Record<string, unknown>
      expect(out.name).toBe('a')
      expect(out.self).toBe('[CIRCULAR]')
    })

    it('handles two-step circular references', () => {
      type A = { name: string; b?: unknown }
      type B = { name: string; a?: unknown }
      const a: A = { name: 'a' }
      const b: B = { name: 'b' }
      a.b = b
      b.a = a
      const out = redact(a) as Record<string, unknown>
      expect(out.name).toBe('a')
      expect(JSON.stringify(out)).toContain('[CIRCULAR]')
    })
  })

  describe('non-mutation', () => {
    it('does not mutate the input object', () => {
      const input = { password: 'secret', user: 'phil' }
      redact(input)
      expect(input.password).toBe('secret')
      expect(input.user).toBe('phil')
    })
  })

  describe('arrays', () => {
    it('redacts inside arrays', () => {
      const out = redact([{ password: 'a' }, { token: 'b' }])
      expect(out).toEqual([{ password: '[REDACTED]' }, { token: '[REDACTED]' }])
    })
  })

  describe('primitives', () => {
    it('passes numbers / booleans / null through', () => {
      expect(redact(42)).toBe(42)
      expect(redact(true)).toBe(true)
      expect(redact(null)).toBe(null)
      expect(redact(undefined)).toBe(undefined)
    })
    it('coerces functions to a marker so JSON.stringify works', () => {
      expect(redact({ fn: () => 1 })).toEqual({ fn: '[FUNCTION]' })
    })
  })
})
