/**
 * Council — multiple LLMs deliberate on a single question, then return a
 * combined answer. Three modes (selected per request):
 *
 *   chairman: each model answers in parallel; a "chairman" model is given
 *             all responses and produces the final synthesis. Cheapest,
 *             fastest, good baseline. Inspired by karpathy/llm-council.
 *
 *   debate:   each model answers (round 1). In round 2 every model sees
 *             the other models' answers and is asked to refine its own,
 *             critiquing where they disagree. The chairman then merges
 *             round-2 answers into the final response. Better at hard
 *             questions where models disagree.
 *
 *   moa:      Mixture-of-Agents (Wang et al. 2024). Two layers of models,
 *             each layer's models see all outputs from the previous
 *             layer as auxiliary context. The chairman synthesises the
 *             final layer. Strongest quality, most tokens.
 *
 * All requests go straight to the configured Ollama Cloud endpoint
 * (https://ollama.com/v1) with the OLLAMA_API_KEY from /opt/data/.env.
 * The Hermes gateway is bypassed because (a) it ignores the per-request
 * `model` field and (b) we want true parallelism without a gateway lock.
 *
 * Streams progress as SSE events:
 *   event: round    data: { round, models }
 *   event: answer   data: { round, model, content }
 *   event: error    data: { model, error }
 *   event: final    data: { content, mode, totalTokens }
 *   event: done     data: { ok: true }
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireWorkspaceAction } from '../../server/route-auth-helpers'
// (auth-middleware import dropped — uses route-auth-helpers below)
import { requireJsonContentType } from '../../server/rate-limit'
import {
  extractAttachmentText,
  renderTextAttachmentsAsBlock,
  type RawAttachment,
} from '../../server/file-reader'

const COUNCIL_SESSIONS_DIR = path.join(
  process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes'),
  'council',
  'sessions',
)

type CouncilSessionRecord = {
  id: string
  startedAt: number
  finishedAt: number | null
  ok: boolean
  mode: string
  models: Array<string>
  chairman: string
  question: string
  attachmentCount: number
  totalTokens: number | null
  finalContent: string | null
  log: Array<unknown>
}

type CouncilMode = 'chairman' | 'debate' | 'moa'

type CouncilRequest = {
  mode?: unknown
  models?: unknown
  chairman?: unknown
  question?: unknown
  rounds?: unknown
  attachments?: unknown
}

const HERMES_HOME =
  process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes')

function readOllamaApiKey(): string {
  // Honour env first, then /opt/data/.env style file.
  const envKey = process.env.OLLAMA_API_KEY
  if (envKey) return envKey
  try {
    const envFile = path.join(HERMES_HOME, '.env')
    const raw = fs.readFileSync(envFile, 'utf-8')
    const match = raw.match(/^OLLAMA_API_KEY=(.+)$/m)
    if (match) return match[1].trim()
  } catch {
    // file missing — fall through
  }
  return ''
}

const OLLAMA_BASE_URL = 'https://ollama.com/v1'

const SYNTH_SYSTEM = `You are the Chairman of an AI council. Several expert models have answered the user's question. Read all of their answers carefully. Produce a single final answer that:

- captures the strongest insights from each
- resolves contradictions explicitly (state which model was right and why)
- omits filler and repetition
- is direct and actionable
- credits no model by name in the final output (it should read as one coherent answer)

If two answers genuinely disagree on a fact, say so and pick the most defensible position with a brief justification.`

const DEBATE_REFINE_SYSTEM = `You previously answered a question. The other council members have now answered too. Read their answers below. Refine your own answer:

- keep what you got right
- update where another model has a stronger argument or fact
- briefly note (1-2 sentences) where you still disagree with another model and why
- stay focused on the original question

Output only your refined answer. No meta-commentary like "after considering the other responses".`

type CallResult = {
  ok: boolean
  content: string
  error?: string
  promptTokens: number
  completionTokens: number
}

async function callModel(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  timeoutMs = 120_000,
): Promise<CallResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return {
        ok: false,
        content: '',
        error: `HTTP ${res.status}: ${text.slice(0, 300)}`,
        promptTokens: 0,
        completionTokens: 0,
      }
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const content = data.choices?.[0]?.message?.content ?? ''
    return {
      ok: true,
      content,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    }
  } catch (err) {
    clearTimeout(timer)
    return {
      ok: false,
      content: '',
      error: err instanceof Error ? err.message : String(err),
      promptTokens: 0,
      completionTokens: 0,
    }
  }
}

function buildRefinePrompt(
  ownAnswer: string,
  otherAnswers: Array<{ model: string; content: string }>,
  question: string,
): string {
  const others = otherAnswers
    .map(
      (a, i) =>
        `--- Member ${i + 1} (${a.model}) said ---\n${a.content.trim()}`,
    )
    .join('\n\n')
  return `Original question:\n${question}\n\nYour previous answer:\n${ownAnswer}\n\nOther council members' answers:\n${others}\n\nRefine your answer.`
}

function buildSynthesisPrompt(
  question: string,
  answers: Array<{ model: string; content: string }>,
): string {
  const compiled = answers
    .map(
      (a, i) =>
        `--- Council member ${i + 1} (${a.model}) ---\n${a.content.trim()}`,
    )
    .join('\n\n')
  return `Original question from the user:\n${question}\n\n${compiled}\n\nProduce the final unified answer now.`
}

export const Route = createFileRoute('/api/council')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = requireWorkspaceAction(request, 'chat')
        if (!guard.ok) return guard.response
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        let body: CouncilRequest
        try {
          body = (await request.json()) as CouncilRequest
        } catch {
          return json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
        }
        const mode = (body.mode as CouncilMode) || 'chairman'
        if (!['chairman', 'debate', 'moa'].includes(mode)) {
          return json({ ok: false, error: 'mode must be chairman | debate | moa' }, { status: 400 })
        }
        const models = Array.isArray(body.models)
          ? (body.models.filter((m) => typeof m === 'string') as Array<string>)
          : []
        if (models.length < 2) {
          return json(
            { ok: false, error: 'at least 2 models required' },
            { status: 400 },
          )
        }
        const chairman = typeof body.chairman === 'string' && body.chairman.trim()
          ? body.chairman.trim()
          : models[0]
        const question = typeof body.question === 'string' ? body.question.trim() : ''
        if (!question) {
          return json({ ok: false, error: 'question required' }, { status: 400 })
        }
        // Attachments → text extraction. Image attachments are ignored for
        // now (multimodal council is a future block) so the user gets a
        // hint event instead of silently dropping content.
        const rawAttachments = Array.isArray(body.attachments)
          ? (body.attachments as Array<RawAttachment>)
          : []
        const extracted = await Promise.all(
          rawAttachments.map((att) => extractAttachmentText(att)),
        )
        const attachmentBlock = renderTextAttachmentsAsBlock(extracted)
        const finalQuestion = attachmentBlock
          ? `${attachmentBlock}\n\n${question}`
          : question
        const apiKey = readOllamaApiKey()
        if (!apiKey) {
          return json(
            { ok: false, error: 'OLLAMA_API_KEY not configured' },
            { status: 500 },
          )
        }

        const sessionRecord: CouncilSessionRecord = {
          id: randomUUID(),
          startedAt: Date.now(),
          finishedAt: null,
          ok: false,
          mode,
          models,
          chairman,
          question,
          attachmentCount: rawAttachments.length,
          totalTokens: null,
          finalContent: null,
          log: [],
        }
        const persistRecord = () => {
          try {
            fs.mkdirSync(COUNCIL_SESSIONS_DIR, { recursive: true })
            const file = path.join(
              COUNCIL_SESSIONS_DIR,
              `${sessionRecord.startedAt}-${sessionRecord.id}.json`,
            )
            fs.writeFileSync(file, JSON.stringify(sessionRecord, null, 2))
          } catch {
            // best-effort persistence
          }
        }

        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            let totalPromptTokens = 0
            let totalCompletionTokens = 0
            const send = (event: string, data: unknown) => {
              const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
              controller.enqueue(encoder.encode(payload))
              // Track for D1 persistence (skip large round-banner events,
              // capture the substantive ones).
              if (event === 'answer' || event === 'error' || event === 'round') {
                sessionRecord.log.push({ event, data })
              }
              if (event === 'final') {
                const f = data as {
                  content?: string
                  totalTokens?: number
                }
                sessionRecord.finalContent = f.content ?? null
                sessionRecord.totalTokens = f.totalTokens ?? null
              }
              if (event === 'done') {
                const d = data as { ok?: boolean }
                sessionRecord.ok = Boolean(d.ok)
                sessionRecord.finishedAt = Date.now()
                persistRecord()
              }
            }

            try {
              if (mode === 'chairman') {
                send('round', { round: 1, models, label: 'Members answer in parallel' })
                const round1 = await Promise.all(
                  models.map((m) =>
                    callModel(apiKey, m, [{ role: 'user', content: finalQuestion }]),
                  ),
                )
                const r1Answers: Array<{ model: string; content: string }> = []
                round1.forEach((r, i) => {
                  totalPromptTokens += r.promptTokens
                  totalCompletionTokens += r.completionTokens
                  if (r.ok) {
                    send('answer', { round: 1, model: models[i], content: r.content })
                    r1Answers.push({ model: models[i], content: r.content })
                  } else {
                    send('error', { model: models[i], error: r.error })
                  }
                })
                if (r1Answers.length === 0) {
                  send('error', { error: 'all council members failed' })
                  send('done', { ok: false })
                  controller.close()
                  return
                }
                send('round', { round: 2, models: [chairman], label: 'Chairman synthesises' })
                const synth = await callModel(apiKey, chairman, [
                  { role: 'system', content: SYNTH_SYSTEM },
                  { role: 'user', content: buildSynthesisPrompt(finalQuestion, r1Answers) },
                ])
                totalPromptTokens += synth.promptTokens
                totalCompletionTokens += synth.completionTokens
                if (!synth.ok) {
                  send('error', { model: chairman, error: synth.error })
                  send('done', { ok: false })
                  controller.close()
                  return
                }
                send('final', {
                  content: synth.content,
                  mode,
                  totalTokens: totalPromptTokens + totalCompletionTokens,
                  promptTokens: totalPromptTokens,
                  completionTokens: totalCompletionTokens,
                  chairman,
                })
                send('done', { ok: true })
                controller.close()
                return
              }

              if (mode === 'debate') {
                const rounds = Math.max(2, Math.min(3, Number(body.rounds) || 2))
                send('round', { round: 1, models, label: 'Members answer in parallel' })
                const r1 = await Promise.all(
                  models.map((m) =>
                    callModel(apiKey, m, [{ role: 'user', content: finalQuestion }]),
                  ),
                )
                const r1Answers: Array<{ model: string; content: string }> = []
                r1.forEach((r, i) => {
                  totalPromptTokens += r.promptTokens
                  totalCompletionTokens += r.completionTokens
                  if (r.ok) {
                    send('answer', { round: 1, model: models[i], content: r.content })
                    r1Answers.push({ model: models[i], content: r.content })
                  } else {
                    send('error', { model: models[i], error: r.error })
                  }
                })
                let currentAnswers = r1Answers
                for (let round = 2; round <= rounds; round++) {
                  send('round', { round, models, label: `Members refine after seeing peers` })
                  const refined = await Promise.all(
                    currentAnswers.map((own, idx) => {
                      const others = currentAnswers.filter((_, i) => i !== idx)
                      return callModel(apiKey, own.model, [
                        { role: 'system', content: DEBATE_REFINE_SYSTEM },
                        {
                          role: 'user',
                          content: buildRefinePrompt(own.content, others, finalQuestion),
                        },
                      ])
                    }),
                  )
                  const next: Array<{ model: string; content: string }> = []
                  refined.forEach((r, i) => {
                    totalPromptTokens += r.promptTokens
                    totalCompletionTokens += r.completionTokens
                    const m = currentAnswers[i].model
                    if (r.ok) {
                      send('answer', { round, model: m, content: r.content })
                      next.push({ model: m, content: r.content })
                    } else {
                      send('error', { model: m, error: r.error })
                      next.push(currentAnswers[i]) // keep prior on failure
                    }
                  })
                  currentAnswers = next
                }
                send('round', { round: rounds + 1, models: [chairman], label: 'Chairman synthesises' })
                const synth = await callModel(apiKey, chairman, [
                  { role: 'system', content: SYNTH_SYSTEM },
                  { role: 'user', content: buildSynthesisPrompt(finalQuestion, currentAnswers) },
                ])
                totalPromptTokens += synth.promptTokens
                totalCompletionTokens += synth.completionTokens
                if (!synth.ok) {
                  send('error', { model: chairman, error: synth.error })
                  send('done', { ok: false })
                  controller.close()
                  return
                }
                send('final', {
                  content: synth.content,
                  mode,
                  rounds,
                  totalTokens: totalPromptTokens + totalCompletionTokens,
                  chairman,
                })
                send('done', { ok: true })
                controller.close()
                return
              }

              // mode === 'moa'
              send('round', { round: 1, models, label: 'Layer 1: parallel answers' })
              const layer1 = await Promise.all(
                models.map((m) =>
                  callModel(apiKey, m, [{ role: 'user', content: finalQuestion }]),
                ),
              )
              const l1: Array<{ model: string; content: string }> = []
              layer1.forEach((r, i) => {
                totalPromptTokens += r.promptTokens
                totalCompletionTokens += r.completionTokens
                if (r.ok) {
                  send('answer', { round: 1, model: models[i], content: r.content })
                  l1.push({ model: models[i], content: r.content })
                } else {
                  send('error', { model: models[i], error: r.error })
                }
              })
              if (l1.length === 0) {
                send('error', { error: 'layer 1 produced no answers' })
                send('done', { ok: false })
                controller.close()
                return
              }
              send('round', {
                round: 2,
                models,
                label: 'Layer 2: each model sees all layer-1 answers',
              })
              const moaPreface =
                'You have access to the responses generated by other council members. Combine the strongest reasoning from those, correct any factual errors, and write your own improved answer to the original question. Do not just copy — synthesise.'
              const layer2 = await Promise.all(
                models.map((m) =>
                  callModel(apiKey, m, [
                    { role: 'system', content: moaPreface },
                    {
                      role: 'user',
                      content: buildSynthesisPrompt(finalQuestion, l1),
                    },
                  ]),
                ),
              )
              const l2: Array<{ model: string; content: string }> = []
              layer2.forEach((r, i) => {
                totalPromptTokens += r.promptTokens
                totalCompletionTokens += r.completionTokens
                if (r.ok) {
                  send('answer', { round: 2, model: models[i], content: r.content })
                  l2.push({ model: models[i], content: r.content })
                } else {
                  send('error', { model: models[i], error: r.error })
                }
              })
              const finalPool = l2.length > 0 ? l2 : l1
              send('round', { round: 3, models: [chairman], label: 'Chairman synthesises final layer' })
              const synth = await callModel(apiKey, chairman, [
                { role: 'system', content: SYNTH_SYSTEM },
                { role: 'user', content: buildSynthesisPrompt(finalQuestion, finalPool) },
              ])
              totalPromptTokens += synth.promptTokens
              totalCompletionTokens += synth.completionTokens
              if (!synth.ok) {
                send('error', { model: chairman, error: synth.error })
                send('done', { ok: false })
                controller.close()
                return
              }
              send('final', {
                content: synth.content,
                mode,
                totalTokens: totalPromptTokens + totalCompletionTokens,
                chairman,
              })
              send('done', { ok: true })
              controller.close()
            } catch (err) {
              send('error', {
                error: err instanceof Error ? err.message : String(err),
              })
              send('done', { ok: false })
              controller.close()
            }
          },
        })
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        })
      },
      GET: async ({ request }) => {
        const guard = requireWorkspaceAction(request, 'chat')
        if (!guard.ok) return guard.response
        const url = new URL(request.url)
        const id = url.searchParams.get('id')
        try {
          if (!fs.existsSync(COUNCIL_SESSIONS_DIR)) {
            return json({ ok: true, sessions: [] })
          }
          const files = fs
            .readdirSync(COUNCIL_SESSIONS_DIR)
            .filter((f) => f.endsWith('.json'))
          if (id) {
            // Reject anything that isn't a plausible UUID-ish id before
            // touching disk. Substring `.includes(id)` previously let a
            // request like `?id=.` match the alphabetically-first session
            // and leak its full record (the listing endpoint truncates the
            // `question`/`log` fields, the detail endpoint does not).
            if (!/^[a-zA-Z0-9_-]{4,128}$/.test(id)) {
              return json({ ok: false, error: 'invalid id format' }, { status: 400 })
            }
            const match = files.find(
              (f) => f === `${id}.json` || f.endsWith(`-${id}.json`),
            )
            if (!match) {
              return json({ ok: false, error: 'session not found' }, { status: 404 })
            }
            const raw = fs.readFileSync(
              path.join(COUNCIL_SESSIONS_DIR, match),
              'utf-8',
            )
            return json({ ok: true, session: JSON.parse(raw) })
          }
          // Index list (newest first, no large `log` field)
          const sessions = files
            .map((f) => {
              try {
                const raw = fs.readFileSync(
                  path.join(COUNCIL_SESSIONS_DIR, f),
                  'utf-8',
                )
                const rec = JSON.parse(raw) as CouncilSessionRecord
                return {
                  id: rec.id,
                  startedAt: rec.startedAt,
                  finishedAt: rec.finishedAt,
                  ok: rec.ok,
                  mode: rec.mode,
                  models: rec.models,
                  chairman: rec.chairman,
                  question: rec.question.slice(0, 200),
                  attachmentCount: rec.attachmentCount,
                  totalTokens: rec.totalTokens,
                }
              } catch {
                return null
              }
            })
            .filter(Boolean)
            .sort(
              (a: any, b: any) => (b?.startedAt ?? 0) - (a?.startedAt ?? 0),
            )
          return json({ ok: true, sessions })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
