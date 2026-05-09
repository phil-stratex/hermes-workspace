# MCP-Federation for the Stratex Predict Stack

> **Status (2026-05-09):** Foundation only. NOT production-deployed. The
> existing `/api/predict-proxy/$.ts` HTTP-bridge keeps serving the
> Workspace UI; nothing in this folder is wired up to anything yet.

This document captures the migration plan for moving inter-stack
communication between **Hermes Workspace** and the **Stratex Predict
API** from the current "browser-fronted HTTP proxy" pattern to a proper
MCP-tool-based federation.

The companion code lives under
[`src/server/mcp-federation/`](../../src/server/mcp-federation/).

---

## Why MCP instead of an HTTP-Proxy

The existing `predict-proxy` is a competent splat-route that forwards
every `/api/predict-proxy/<path>` request through to the
`stratex-predict-api` sibling container, injecting the bearer token
server-side. It works, but:

| Concern | HTTP-Proxy (current) | MCP-Federation (target) |
| --- | --- | --- |
| Discoverability | Agents need a hand-written prompt that explains every endpoint and shape. | Tools register with name + JSON-Schema; the model can enumerate them. |
| Validation | The Workspace doesn't know if the URL it's calling exists until 404. | `tools/list` is the contract; bad calls fail in the JSON-RPC layer. |
| Coupling | Workspace UI hardcodes `/api/predict-proxy/...` paths everywhere (see `predict-client.ts`). | Tool names are stable; transport changes (stdio vs. unix-socket vs. tunnel) don't ripple into call sites. |
| Multi-stack | Adding a third stack means a new proxy splat per stack. | Adding a third stack means another MCP-server registration. |
| Auth model | Single shared `PREDICT_API_TOKEN`, no per-call attribution. | Future: per-user tokens + audit-trail via the Hermes audit-log. |
| SSE | Streaming works (the splat-route forwards the body unchanged). | Out of scope for this PR — needs a separate "resource" abstraction. |

The federation pattern is also already in use in this repo for
workspace-to-workspace replication (`src/server/federation-mcp-server.ts`).
Reusing the same wire-format for cross-stack federation keeps the
mental model consistent.

---

## What ships in this PR (foundation)

`src/server/mcp-federation/predict-tools.ts` — three tool stubs as plain
async TypeScript functions plus a `PREDICT_TOOLS` registry of
JSON-Schema descriptors:

| Tool | Args | Returns | Backed by |
| --- | --- | --- | --- |
| `predict_list_projects` | `{ limit?: number }` | `Array<ProjectSummary>` | `GET /api/projects` |
| `predict_get_report` | `{ reportId: string }` | `ReportDetail` | `GET /api/reports/{id}` |
| `predict_get_simulation_status` | `{ simulationId: string }` | `RunTaskState \| null` | `GET /api/simulations/{id}/run-status` |

Plus a thin `dispatchPredictTool(name, args)` helper so a future MCP
entry point can be a 20-line stdio-loop on top of these functions.

`src/server/mcp-federation/predict-tools.test.ts` — 30 vitest cases
with `vi.fn()`-stubbed `global.fetch`. Verified green
(`pnpm vitest run src/server/mcp-federation/predict-tools.test.ts`).

What is **NOT** here:

- No actual MCP-server entry point (no stdin/stdout JSON-RPC loop).
- No package `@modelcontextprotocol/sdk` dependency (intentionally; see
  Setup below).
- No registration in any Workspace settings, no Hermes-Agent config
  changes.
- No auth / per-user token forwarding.
- No streaming / SSE-tool design.

---

## Setup for full deploy (roadmap)

### 1. Install the MCP SDK

```bash
pnpm add @modelcontextprotocol/sdk
```

After install, re-type the registry to use the SDK's official `Tool`
type:

```ts
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export const PREDICT_TOOLS: ReadonlyArray<Tool> = [/* ... */]
```

The shape of the JSON we emit today already matches `Tool` —
`name`, `description`, `inputSchema { type, properties, required, additionalProperties }`.

### 2. Wire up an MCP-stdio server

Create `src/server/mcp-federation/server.ts`:

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { PREDICT_TOOLS, dispatchPredictTool } from './predict-tools'

const server = new Server(
  { name: 'stratex-predict-federation', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: PREDICT_TOOLS as unknown as never,
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const result = await dispatchPredictTool(
    req.params.name,
    req.params.arguments ?? {},
  )
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  }
})

await server.connect(new StdioServerTransport())
```

Then ship a CLI entry script (mirror the pattern of
`scripts/mcp-federation-stdio.ts` referenced from `federation-mcp-server.ts`).

### 3. Register the server with the Hermes-Agent

Add an entry in `~/.hermes/mcp-servers.json` (or the per-workspace
equivalent):

```json
{
  "stratex-predict": {
    "command": "node",
    "args": ["/app/dist/server/mcp-federation/server.js"],
    "env": {
      "PREDICT_API_URL": "http://stratex-predict-api:5101",
      "PREDICT_API_TOKEN": "<inject from compose env>"
    }
  }
}
```

Inside the VPS compose, both containers share a network, so the inner
hostname resolves directly.

### 4. Auth / token forwarding

Today the bearer token is read from `process.env.PREDICT_API_TOKEN`
inside the workspace process and injected into every fetch — same
pattern the HTTP-proxy uses today. This works, but loses per-user
attribution.

Two future paths:

- **Trusted-stack model (MVP):** keep the env-var bearer, but stamp
  every `dispatchPredictTool` call into the audit-log
  (`appendAuditEvent('global', { type: 'mcp_predict_call', tool, userId, args })`)
  so we can reconstruct who triggered what.
- **Delegated-token model (later):** the Workspace mints short-lived
  per-user JWTs, the MCP-server forwards them as `Authorization: Bearer`,
  and Predict's `auth.py:require_bearer` validates against a JWKS that
  the Workspace publishes. Requires changes on the Predict side; out of
  scope for the foundation PR.

### 5. Streaming / SSE

Three of the most useful Predict endpoints are SSE:

- `GET /api/projects/{id}/build/events`
- `GET /api/simulations/{id}/prepare/events`
- `GET /api/simulations/{id}/run/events`
- `GET /api/reports/{id}/events`
- `GET /api/reports/{id}/interview/batch/{batchId}/events`

MCP's `tools/call` is request/response, so SSE doesn't fit directly. Two
options:

1. **Polling-tool wrapper:** add e.g. `predict_poll_run_events(simulationId, sinceCursor)`
   that internally subscribes for ~5s, drains, and returns an array.
   Works, lossy at boundaries.
2. **Resource subscription:** model the SSE feed as an MCP "resource"
   and stream notifications via the protocol's resource-update pattern.
   Cleaner, but more SDK glue.

Decision deferred until the polling-tool MVP shows clear ergonomics
problems.

---

## Tool inventory (what the agent will see)

After full deploy, the Hermes-Agent's `tools/list` for the
`stratex-predict` server will return:

```jsonc
[
  {
    "name": "predict_list_projects",
    "description": "List recent Stratex-Predict projects with build-state and simulation/report counts. Use when the user asks about ongoing predictions or wants to enumerate available projects.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "predict_get_report",
    "description": "Fetch a Stratex-Predict report including all generated sections. Use after a report has been created and the user wants to read or summarize it.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "reportId": { "type": "string" }
      },
      "required": ["reportId"],
      "additionalProperties": false
    }
  },
  {
    "name": "predict_get_simulation_status",
    "description": "Get the current run-status of a Predict simulation (progress, current round, stop-requested flag). Returns null if the simulation has never been started.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "simulationId": { "type": "string" }
      },
      "required": ["simulationId"],
      "additionalProperties": false
    }
  }
]
```

---

## Migration plan — predict-proxy → MCP-Federation

The migration is **iterative, never big-bang**. Each step ships
independently and doesn't break the proxy until the cut-over is
deliberately taken.

| Step | Description | PR-Size |
| --- | --- | --- |
| 0 (this PR) | Foundation: tool stubs + tests + roadmap doc. | S |
| 1 | Add `@modelcontextprotocol/sdk`, ship `server.ts` and a CLI entry. Register with the Hermes-Agent in dev. | M |
| 2 | Add 3-5 more tools covering the remaining read-only endpoints (`predict_list_simulations`, `predict_list_reports`, `predict_get_project`, `predict_list_personas`, `predict_get_agent_stats`). | M |
| 3 | Audit-log integration; stamp every `dispatchPredictTool` call with userId/workspaceId. | S |
| 4 | Migrate one Workspace UI surface (e.g. the project-list panel) from `predict-client.ts → fetch /api/predict-proxy` to MCP-tool-call via the agent. Demonstrate parity. | M |
| 5 | Streaming / SSE-tool design + implementation (probably polling-tool MVP). | L |
| 6 | Migrate the rest of `predict-client.ts` consumers; gate the proxy behind a feature flag. | L |
| 7 | Remove `src/routes/api/predict-proxy/$.ts`. | XS |

Sequencing means the predict-proxy stays the source of truth for
workspace UI calls until step 6, while the agent gradually gains
first-class tool access in steps 1–3.

---

## Operational notes

- **Default base URL** in dev is `http://stratex-predict-api:5101`
  (matches the predict-proxy default). Override via `PREDICT_API_URL`
  or `STRATEX_PREDICT_API_URL`. Trailing slash is stripped automatically.
- **Bearer token** is read from `PREDICT_API_TOKEN` /
  `STRATEX_PREDICT_API_TOKEN`. Empty (the dev default) means no
  Authorization header is sent — works against a Predict instance with
  empty `PREDICT_API_TOKEN` (which itself disables auth).
- **Timeout** is hardcoded at 10s per tool call. Predict's report
  generation can take much longer than that; non-streaming tools that
  start a job (POST routes) are intentionally NOT in this foundation.
