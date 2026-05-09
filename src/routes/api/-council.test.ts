/**
 * Smoke tests for src/routes/api/council.ts.
 *
 * Scope: HTTP-input validation + GET-persistence-error-paths only. The SSE
 * stream content, real Ollama-Cloud fetch, and MoA synthesis are
 * deliberately out-of-scope here (integration-test territory) — see the
 * out-of-scope section in the PR body.
 *
 * Mocking strategy mirrors `src/routes/api/-mcp.test.ts`:
 *   - `@tanstack/react-router.createFileRoute` is replaced with an
 *     identity wrapper so we can pull the handlers out of `Route.server`.
 *   - `@tanstack/react-start.json` is replaced with a thin Response
 *     factory that preserves status and Content-Type.
 *   - `route-auth-helpers.requireWorkspaceAction` returns ok:true so we
 *     can exercise the validation logic past the auth gate.
 *   - `rate-limit.requireJsonContentType` is left untouched; we send the
 *     correct Content-Type header in every POST.
 *   - HERMES_HOME is redirected to a tmp dir for the GET tests so the
 *     persistence-on-disk path is isolated from the real workspace.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (cfg: unknown) => cfg,
}))

vi.mock('@tanstack/react-start', () => ({
  json: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), {
      ...(init || {}),
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    }),
}))

vi.mock('../../server/route-auth-helpers', () => ({
  requireWorkspaceAction: () => ({
    ok: true,
    value: { user: null, wsId: null, multiTenant: false },
  }),
}))

// Default file-reader behaviour: pretend no attachments parse to text.
// Individual tests override via vi.mocked(...).mockResolvedValue(...).
vi.mock('../../server/file-reader', () => ({
  extractAttachmentText: vi.fn(async (att: { name?: string }) => ({
    kind: 'unsupported' as const,
    name: att.name ?? 'attachment',
    contentType: 'application/octet-stream',
    hint: 'mocked',
  })),
  renderTextAttachmentsAsBlock: vi.fn(() => ''),
}))

let tempHome = ''
const originalHermesHome = process.env.HERMES_HOME
const originalOllamaKey = process.env.OLLAMA_API_KEY

type Handlers = {
  POST: (ctx: { request: Request }) => Promise<Response>
  GET: (ctx: { request: Request }) => Promise<Response>
}

async function loadHandlers(): Promise<Handlers> {
  vi.resetModules()
  const mod = (await import('./council')) as unknown as {
    Route: { server: { handlers: Handlers } }
  }
  return mod.Route.server.handlers
}

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/council', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  // Each test gets its own tmpdir so persistence reads are isolated.
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'council-route-test-'))
  process.env.HERMES_HOME = tempHome
  // POST validation tests don't reach the streaming path, but a couple
  // of branches early-return on missing key. Set a sentinel so we always
  // exit on the validation error (the path we care about), not on the
  // 'OLLAMA_API_KEY not configured' branch.
  process.env.OLLAMA_API_KEY = 'test-key-not-used'
  // Stub global fetch so an accidental SSE stream-start can't escape
  // the test process and hit ollama.com. Each test below early-exits
  // before reaching this fetch, but defence in depth is cheap.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('fetch must not be called in smoke tests')
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  fs.rmSync(tempHome, { recursive: true, force: true })
  if (originalHermesHome === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = originalHermesHome
  if (originalOllamaKey === undefined) delete process.env.OLLAMA_API_KEY
  else process.env.OLLAMA_API_KEY = originalOllamaKey
})

// ─── POST validation ──────────────────────────────────────────────────

describe('POST /api/council — input validation', () => {
  it('returns 400 when the request body is not valid JSON', async () => {
    const { POST } = await loadHandlers()
    const req = new Request('http://localhost/api/council', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    })
    const res = await POST({ request: req })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/invalid json/i)
  })

  it('returns 400 when mode is not chairman | debate | moa', async () => {
    const { POST } = await loadHandlers()
    const res = await POST({
      request: jsonRequest({
        mode: 'invalid',
        models: ['a', 'b'],
        question: 'hi',
      }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/mode must be/i)
  })

  it('returns 400 when fewer than 2 models are provided', async () => {
    const { POST } = await loadHandlers()
    const res = await POST({
      request: jsonRequest({
        mode: 'chairman',
        models: ['only-one'],
        question: 'hi',
      }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/at least 2 models/i)
  })

  it('returns 400 when models is missing entirely (treated as empty array)', async () => {
    const { POST } = await loadHandlers()
    const res = await POST({
      request: jsonRequest({ mode: 'chairman', question: 'hi' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.error).toMatch(/at least 2 models/i)
  })

  it('returns 400 when question is missing or whitespace-only', async () => {
    const { POST } = await loadHandlers()
    const res = await POST({
      request: jsonRequest({
        mode: 'chairman',
        models: ['a', 'b'],
        question: '   ',
      }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.error).toMatch(/question required/i)
  })

  it('defaults to mode=chairman when mode is omitted (does not 400)', async () => {
    // No `mode` field — body.mode is undefined, defaulted to 'chairman'.
    // This must NOT produce a 400 from the mode-allowlist branch. The
    // validation pipeline should advance to the next gate (models/question)
    // and only fail there, not on the mode line.
    const { POST } = await loadHandlers()
    const res = await POST({
      request: jsonRequest({ models: ['a'], question: 'hi' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean; error: string }
    // Should reject on models count, not on mode.
    expect(body.error).not.toMatch(/mode must be/i)
    expect(body.error).toMatch(/at least 2 models/i)
  })

  it('returns 415 when Content-Type is not application/json', async () => {
    // CSRF gate from rate-limit.ts. Defence-in-depth check: ensures the
    // gate fires before the JSON parse and before validation, returning
    // the right status.
    const { POST } = await loadHandlers()
    const req = new Request('http://localhost/api/council', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    })
    const res = await POST({ request: req })
    expect(res.status).toBe(415)
  })
})

// ─── GET list / detail ────────────────────────────────────────────────

describe('GET /api/council — listing + detail', () => {
  it('returns ok:true with an empty list when the sessions dir does not exist', async () => {
    const { GET } = await loadHandlers()
    const req = new Request('http://localhost/api/council')
    const res = await GET({ request: req })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      sessions: Array<unknown>
    }
    expect(body.ok).toBe(true)
    expect(body.sessions).toEqual([])
  })

  it('returns ok:true with an empty list when the sessions dir exists but is empty', async () => {
    fs.mkdirSync(path.join(tempHome, 'council', 'sessions'), { recursive: true })
    const { GET } = await loadHandlers()
    const res = await GET({ request: new Request('http://localhost/api/council') })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      sessions: Array<unknown>
    }
    expect(body.ok).toBe(true)
    expect(body.sessions).toEqual([])
  })

  it('returns 404 with ok:false when the requested session id is unknown', async () => {
    fs.mkdirSync(path.join(tempHome, 'council', 'sessions'), { recursive: true })
    const { GET } = await loadHandlers()
    // Valid format (matches /^[a-zA-Z0-9_-]{4,128}$/) so we hit the
    // disk-lookup branch and the 404 path, NOT the 400 invalid-id branch.
    const req = new Request(
      'http://localhost/api/council?id=11111111-1111-1111-1111-111111111111',
    )
    const res = await GET({ request: req })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/session not found/i)
  })

  it('returns 400 when the requested session id has invalid characters (path-traversal guard)', async () => {
    // Substring `.includes(id)` previously let `?id=.` leak the
    // alphabetically-first session. The format gate (`/^[a-zA-Z0-9_-]{4,128}$/`)
    // is the regression fix — assert it stays in place.
    fs.mkdirSync(path.join(tempHome, 'council', 'sessions'), { recursive: true })
    const { GET } = await loadHandlers()
    const res = await GET({
      request: new Request('http://localhost/api/council?id=.'),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.error).toMatch(/invalid id format/i)
  })

  it('returns the persisted session record when id matches an on-disk file', async () => {
    const sessionsDir = path.join(tempHome, 'council', 'sessions')
    fs.mkdirSync(sessionsDir, { recursive: true })
    const id = 'aaaa-bbbb-cccc-dddd'
    const startedAt = 1_700_000_000_000
    const record = {
      id,
      startedAt,
      finishedAt: startedAt + 1000,
      ok: true,
      mode: 'chairman',
      models: ['a', 'b'],
      chairman: 'a',
      question: 'why is the sky blue?',
      attachmentCount: 0,
      totalTokens: 42,
      finalContent: 'because rayleigh',
      log: [],
    }
    fs.writeFileSync(
      path.join(sessionsDir, `${startedAt}-${id}.json`),
      JSON.stringify(record),
    )

    const { GET } = await loadHandlers()
    const res = await GET({
      request: new Request(`http://localhost/api/council?id=${id}`),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      session: { id: string; mode: string; finalContent: string }
    }
    expect(body.ok).toBe(true)
    expect(body.session.id).toBe(id)
    expect(body.session.mode).toBe('chairman')
    expect(body.session.finalContent).toBe('because rayleigh')
  })

  it('list mode truncates the question field to 200 chars and omits the log field', async () => {
    const sessionsDir = path.join(tempHome, 'council', 'sessions')
    fs.mkdirSync(sessionsDir, { recursive: true })
    const id = 'eeee-ffff-1111-2222'
    const startedAt = 1_700_000_001_000
    const longQuestion = 'q'.repeat(500)
    const record = {
      id,
      startedAt,
      finishedAt: null,
      ok: false,
      mode: 'chairman',
      models: ['a', 'b'],
      chairman: 'a',
      question: longQuestion,
      attachmentCount: 0,
      totalTokens: null,
      finalContent: null,
      log: [{ event: 'answer', data: { round: 1, model: 'a', content: 'x' } }],
    }
    fs.writeFileSync(
      path.join(sessionsDir, `${startedAt}-${id}.json`),
      JSON.stringify(record),
    )

    const { GET } = await loadHandlers()
    const res = await GET({
      request: new Request('http://localhost/api/council'),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      sessions: Array<{ id: string; question: string; log?: unknown }>
    }
    expect(body.ok).toBe(true)
    expect(body.sessions).toHaveLength(1)
    expect(body.sessions[0].id).toBe(id)
    expect(body.sessions[0].question.length).toBe(200)
    // Listing endpoint omits the `log` field by design.
    expect(body.sessions[0].log).toBeUndefined()
  })
})
