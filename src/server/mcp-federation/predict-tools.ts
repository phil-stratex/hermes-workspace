/**
 * MCP-Federation — Predict-Stack tool stubs (FOUNDATION ONLY).
 *
 * These are skeleton tool-implementations for the future MCP-server that
 * will replace the current `/api/predict-proxy/$.ts` HTTP-bridge. The
 * functions below are pure (just fetch + JSON), so they can be:
 *   1. unit-tested with a fetch-mock (see `predict-tools.test.ts`)
 *   2. wrapped later in an actual MCP-stdio server (Roadmap step 2 of
 *      `scripts/dev/mcp-federation-README.md`)
 *
 * Why MCP > HTTP-Proxy (short version):
 *   - MCP tools are first-class for the agent — auto-discovered, with
 *     schemas, no manual prompt-engineering of "call this URL with this
 *     body".
 *   - The Predict-stack is OUR stack on the same VPS; plumbing a
 *     model-context-protocol channel between the two is more honest than
 *     forwarding browser HTTP requests.
 *   - Migration is iterative: each tool added here can be progressively
 *     adopted while predict-proxy keeps serving the workspace UI.
 *
 * Status (2026-05-09): foundation. NOT production-deployed. The
 * `@modelcontextprotocol/sdk` package is intentionally NOT a dependency
 * yet — we ship the tool-schemas as plain JSON so the file imports
 * cleanly even without the SDK installed. See README for install
 * instructions.
 *
 * Out of scope for this file:
 *   - Auth / token forwarding (env-vars only — no per-user delegation)
 *   - Streaming / SSE-tools (would need different MCP-resource shape)
 *   - The MCP-server entry point itself (stdin/stdout JSON-RPC loop)
 */

// ─── Configuration ─────────────────────────────────────────────────────

/** Base URL of the Predict-API container in the VPS-Compose. */
const DEFAULT_PREDICT_BASE = 'http://stratex-predict-api:5101'

function predictBaseUrl(): string {
  return (
    process.env.PREDICT_API_URL ||
    process.env.STRATEX_PREDICT_API_URL ||
    DEFAULT_PREDICT_BASE
  ).replace(/\/$/, '')
}

function predictBearer(): string {
  return (
    process.env.PREDICT_API_TOKEN ||
    process.env.STRATEX_PREDICT_API_TOKEN ||
    ''
  )
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra }
  const bearer = predictBearer()
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  return headers
}

const DEFAULT_TIMEOUT_MS = 10_000

// ─── Tool 1: predict_list_projects ────────────────────────────────────

export type PredictListProjectsArgs = {
  /** Maximum number of projects to return (server caps at its own ceiling). */
  limit?: number
}

export type ProjectSummary = {
  project_id: string
  prompt: string
  status: string
  created_at: string
  document_count: number
  build_task: {
    id: string
    phase: number
    progress: number
    status: string
    error: string | null
  } | null
  simulation_count: number
  report_count: number
}

/**
 * GET /api/projects[?limit=N] — list recent Predict projects with
 * build-state and simulation/report counts.
 */
export async function predictListProjects(
  args: PredictListProjectsArgs = {},
): Promise<Array<ProjectSummary>> {
  const url = new URL(`${predictBaseUrl()}/api/projects`)
  if (typeof args.limit === 'number' && Number.isFinite(args.limit)) {
    url.searchParams.set('limit', String(Math.max(1, Math.floor(args.limit))))
  }

  const res = await fetch(url, {
    method: 'GET',
    headers: authHeaders(),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = await safeReadBody(res)
    throw new Error(
      `predict_list_projects failed: ${res.status} ${res.statusText} ${detail}`.trim(),
    )
  }
  return (await res.json()) as Array<ProjectSummary>
}

// ─── Tool 2: predict_get_report ───────────────────────────────────────

export type PredictGetReportArgs = {
  /** Report-id returned by `POST /api/reports`. */
  reportId: string
}

export type ReportSection = {
  slug: string
  title: string
  ordering: number
  status: string
  content: string
  error: string | null
}

export type ReportDetail = {
  report_id: string
  simulation_id: string
  status: string
  progress: number
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  sections: Array<ReportSection>
}

/**
 * GET /api/reports/{reportId} — full report metadata + section payloads.
 *
 * Note: this is the snapshot endpoint, NOT the SSE event stream. Live
 * progress would require a separate streaming-tool design (see roadmap).
 */
export async function predictGetReport(
  args: PredictGetReportArgs,
): Promise<ReportDetail> {
  if (!args.reportId || typeof args.reportId !== 'string') {
    throw new Error('predict_get_report: reportId is required')
  }
  const url = `${predictBaseUrl()}/api/reports/${encodeURIComponent(args.reportId)}`

  const res = await fetch(url, {
    method: 'GET',
    headers: authHeaders(),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = await safeReadBody(res)
    throw new Error(
      `predict_get_report failed: ${res.status} ${res.statusText} ${detail}`.trim(),
    )
  }
  return (await res.json()) as ReportDetail
}

// ─── Tool 3: predict_get_simulation_status ────────────────────────────

export type PredictGetSimulationStatusArgs = {
  /** Simulation-id returned by `POST /api/simulations`. */
  simulationId: string
}

export type RunTaskState = {
  id: string
  progress: number
  status: string
  error: string | null
  current_round: number
  target_rounds: number
  stop_requested: boolean
}

/**
 * GET /api/simulations/{id}/run-status — current run-state of a
 * simulation, or `null` if no run was ever started.
 */
export async function predictGetSimulationStatus(
  args: PredictGetSimulationStatusArgs,
): Promise<RunTaskState | null> {
  if (!args.simulationId || typeof args.simulationId !== 'string') {
    throw new Error('predict_get_simulation_status: simulationId is required')
  }
  const url = `${predictBaseUrl()}/api/simulations/${encodeURIComponent(
    args.simulationId,
  )}/run-status`

  const res = await fetch(url, {
    method: 'GET',
    headers: authHeaders(),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = await safeReadBody(res)
    throw new Error(
      `predict_get_simulation_status failed: ${res.status} ${res.statusText} ${detail}`.trim(),
    )
  }
  if (res.status === 204) return null
  return (await res.json()) as RunTaskState | null
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function safeReadBody(res: Response): Promise<string> {
  try {
    const text = await res.text()
    return text.slice(0, 240)
  } catch {
    return ''
  }
}

// ─── Tool registry (MCP-shaped, no SDK dependency) ────────────────────

/**
 * Plain JSON-Schema tool definitions. When `@modelcontextprotocol/sdk`
 * is added in a follow-up PR, this array can be cast to the SDK's
 * `Tool[]` type without any code changes — the shape is identical to
 * `mcp::tools/list`.
 *
 * See https://spec.modelcontextprotocol.io/specification/server/tools/
 */
export type ToolDefinition = {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: Array<string>
    additionalProperties?: boolean
  }
}

export const PREDICT_TOOLS: ReadonlyArray<ToolDefinition> = [
  {
    name: 'predict_list_projects',
    description:
      'List recent Stratex-Predict projects with build-state and simulation/report counts. ' +
      'Use when the user asks about ongoing predictions or wants to enumerate available projects.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description: 'Maximum number of projects (server caps further).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'predict_get_report',
    description:
      'Fetch a Stratex-Predict report including all generated sections. ' +
      'Use after a report has been created and the user wants to read or summarize it.',
    inputSchema: {
      type: 'object',
      properties: {
        reportId: {
          type: 'string',
          description: 'Report id returned by POST /api/reports.',
        },
      },
      required: ['reportId'],
      additionalProperties: false,
    },
  },
  {
    name: 'predict_get_simulation_status',
    description:
      'Get the current run-status of a Predict simulation (progress, current round, stop-requested flag). ' +
      'Returns null if the simulation has never been started.',
    inputSchema: {
      type: 'object',
      properties: {
        simulationId: {
          type: 'string',
          description: 'Simulation id returned by POST /api/simulations.',
        },
      },
      required: ['simulationId'],
      additionalProperties: false,
    },
  },
] as const

/**
 * Dispatcher used by the future MCP-server entry point. Maps a tool
 * name + raw argument-bag to the corresponding implementation. Args
 * are typed as `unknown` because the JSON-RPC layer hands them in
 * un-validated; each tool function does its own argument-shape check.
 */
export async function dispatchPredictTool(
  name: string,
  args: unknown,
): Promise<unknown> {
  const safeArgs = (args && typeof args === 'object' ? args : {}) as Record<
    string,
    unknown
  >
  switch (name) {
    case 'predict_list_projects':
      return predictListProjects(safeArgs as PredictListProjectsArgs)
    case 'predict_get_report':
      return predictGetReport(safeArgs as PredictGetReportArgs)
    case 'predict_get_simulation_status':
      return predictGetSimulationStatus(safeArgs as PredictGetSimulationStatusArgs)
    default:
      throw new Error(`Unknown Predict tool: ${name}`)
  }
}

// Test-only re-export to let unit-tests verify env-resolution without
// reaching into module internals.
export const __testOnly = { predictBaseUrl, predictBearer }
