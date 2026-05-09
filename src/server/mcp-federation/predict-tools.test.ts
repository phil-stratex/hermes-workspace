/**
 * Tests for the Predict MCP-Federation tool stubs.
 *
 * Strategy: stub `global.fetch` per-test, assert on the URL/method/headers
 * the tools dispatch, and on how they map response bodies + error codes.
 * No live network calls; no SDK dependency required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PREDICT_TOOLS,
  dispatchPredictTool,
  predictGetReport,
  predictGetSimulationStatus,
  predictListProjects,
  __testOnly,
} from './predict-tools'

let originalFetch: typeof global.fetch
let originalEnv: Record<string, string | undefined>

function makeFetchMock(
  status: number,
  body: unknown,
  opts: { statusText?: string } = {},
): typeof fetch {
  const ok = status >= 200 && status < 300
  return vi.fn().mockResolvedValue({
    status,
    statusText: opts.statusText ?? (ok ? 'OK' : 'Error'),
    ok,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  }) as unknown as typeof fetch
}

beforeEach(() => {
  originalFetch = global.fetch
  originalEnv = {
    PREDICT_API_URL: process.env.PREDICT_API_URL,
    STRATEX_PREDICT_API_URL: process.env.STRATEX_PREDICT_API_URL,
    PREDICT_API_TOKEN: process.env.PREDICT_API_TOKEN,
    STRATEX_PREDICT_API_TOKEN: process.env.STRATEX_PREDICT_API_TOKEN,
  }
  // Pin a deterministic base for assertions.
  process.env.PREDICT_API_URL = 'http://predict.test:5101'
  delete process.env.STRATEX_PREDICT_API_URL
  delete process.env.PREDICT_API_TOKEN
  delete process.env.STRATEX_PREDICT_API_TOKEN
})

afterEach(() => {
  global.fetch = originalFetch
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  vi.restoreAllMocks()
})

// ─── env / config resolution ──────────────────────────────────────────

describe('env resolution', () => {
  it('uses PREDICT_API_URL when set', () => {
    process.env.PREDICT_API_URL = 'http://custom:9000'
    expect(__testOnly.predictBaseUrl()).toBe('http://custom:9000')
  })

  it('falls back to STRATEX_PREDICT_API_URL', () => {
    delete process.env.PREDICT_API_URL
    process.env.STRATEX_PREDICT_API_URL = 'http://stratex-alt:5101'
    expect(__testOnly.predictBaseUrl()).toBe('http://stratex-alt:5101')
  })

  it('falls back to default container hostname when neither env-var is set', () => {
    delete process.env.PREDICT_API_URL
    delete process.env.STRATEX_PREDICT_API_URL
    expect(__testOnly.predictBaseUrl()).toBe('http://stratex-predict-api:5101')
  })

  it('strips trailing slash from base URL', () => {
    process.env.PREDICT_API_URL = 'http://predict.test:5101/'
    expect(__testOnly.predictBaseUrl()).toBe('http://predict.test:5101')
  })

  it('returns empty bearer when neither token env-var is set', () => {
    expect(__testOnly.predictBearer()).toBe('')
  })

  it('uses PREDICT_API_TOKEN when set', () => {
    process.env.PREDICT_API_TOKEN = 'secret-1'
    expect(__testOnly.predictBearer()).toBe('secret-1')
  })
})

// ─── predict_list_projects ────────────────────────────────────────────

describe('predictListProjects', () => {
  it('GETs /api/projects without query params when no args given', async () => {
    const fetchMock = makeFetchMock(200, [])
    global.fetch = fetchMock

    await predictListProjects()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [urlArg, init] = (fetchMock as unknown as { mock: { calls: Array<[URL | string, RequestInit]> } }).mock.calls[0]
    const url = typeof urlArg === 'string' ? new URL(urlArg) : urlArg
    expect(url.toString()).toBe('http://predict.test:5101/api/projects')
    expect(init.method).toBe('GET')
  })

  it('appends ?limit=N when limit is given', async () => {
    const fetchMock = makeFetchMock(200, [])
    global.fetch = fetchMock

    await predictListProjects({ limit: 25 })

    const [urlArg] = (fetchMock as unknown as { mock: { calls: Array<[URL | string]> } }).mock.calls[0]
    const url = typeof urlArg === 'string' ? new URL(urlArg) : urlArg
    expect(url.searchParams.get('limit')).toBe('25')
  })

  it('forwards bearer token when PREDICT_API_TOKEN is set', async () => {
    process.env.PREDICT_API_TOKEN = 'super-secret'
    const fetchMock = makeFetchMock(200, [])
    global.fetch = fetchMock

    await predictListProjects()

    const [, init] = (fetchMock as unknown as { mock: { calls: Array<[unknown, RequestInit]> } }).mock.calls[0]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer super-secret')
  })

  it('omits Authorization header when no token configured', async () => {
    const fetchMock = makeFetchMock(200, [])
    global.fetch = fetchMock

    await predictListProjects()

    const [, init] = (fetchMock as unknown as { mock: { calls: Array<[unknown, RequestInit]> } }).mock.calls[0]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('returns the parsed JSON array on 200', async () => {
    const payload = [
      { project_id: 'p-1', prompt: 'first', status: 'completed' },
      { project_id: 'p-2', prompt: 'second', status: 'building' },
    ]
    global.fetch = makeFetchMock(200, payload)

    const result = await predictListProjects()
    expect(result).toEqual(payload)
  })

  it('throws with status code on non-2xx response', async () => {
    global.fetch = makeFetchMock(503, 'predict-api unreachable', {
      statusText: 'Service Unavailable',
    })

    await expect(predictListProjects()).rejects.toThrow(/predict_list_projects failed: 503/)
  })

  it('clamps non-integer limit values to a sensible floor', async () => {
    const fetchMock = makeFetchMock(200, [])
    global.fetch = fetchMock

    await predictListProjects({ limit: 0.7 })

    const [urlArg] = (fetchMock as unknown as { mock: { calls: Array<[URL | string]> } }).mock.calls[0]
    const url = typeof urlArg === 'string' ? new URL(urlArg) : urlArg
    // Math.max(1, floor(0.7)) = max(1, 0) = 1
    expect(url.searchParams.get('limit')).toBe('1')
  })
})

// ─── predict_get_report ───────────────────────────────────────────────

describe('predictGetReport', () => {
  it('GETs /api/reports/{reportId} with the encoded id', async () => {
    const fetchMock = makeFetchMock(200, { report_id: 'r-1', sections: [] })
    global.fetch = fetchMock

    await predictGetReport({ reportId: 'r-1' })

    const [urlArg, init] = (fetchMock as unknown as { mock: { calls: Array<[URL | string, RequestInit]> } }).mock.calls[0]
    const url = typeof urlArg === 'string' ? urlArg : urlArg.toString()
    expect(url).toBe('http://predict.test:5101/api/reports/r-1')
    expect(init.method).toBe('GET')
  })

  it('URL-encodes report ids that contain unsafe characters', async () => {
    const fetchMock = makeFetchMock(200, { report_id: 'r/1', sections: [] })
    global.fetch = fetchMock

    await predictGetReport({ reportId: 'r/1' })

    const [urlArg] = (fetchMock as unknown as { mock: { calls: Array<[URL | string]> } }).mock.calls[0]
    const url = typeof urlArg === 'string' ? urlArg : urlArg.toString()
    expect(url).toBe('http://predict.test:5101/api/reports/r%2F1')
  })

  it('returns the parsed report on 200', async () => {
    const payload = {
      report_id: 'r-1',
      simulation_id: 's-1',
      status: 'completed',
      progress: 1,
      sections: [{ slug: 'exec', title: 'Executive', ordering: 1, status: 'completed', content: '...', error: null }],
    }
    global.fetch = makeFetchMock(200, payload)

    const result = await predictGetReport({ reportId: 'r-1' })
    expect(result.report_id).toBe('r-1')
    expect(result.sections).toHaveLength(1)
  })

  it('throws on missing reportId', async () => {
    await expect(
      // @ts-expect-error — runtime check for the un-typed call path.
      predictGetReport({}),
    ).rejects.toThrow(/reportId is required/)
  })

  it('throws on 404', async () => {
    global.fetch = makeFetchMock(404, 'not found', { statusText: 'Not Found' })

    await expect(predictGetReport({ reportId: 'missing' })).rejects.toThrow(
      /predict_get_report failed: 404/,
    )
  })
})

// ─── predict_get_simulation_status ────────────────────────────────────

describe('predictGetSimulationStatus', () => {
  it('GETs /api/simulations/{id}/run-status', async () => {
    const fetchMock = makeFetchMock(200, {
      id: 'rt-1',
      progress: 0.5,
      status: 'running',
      error: null,
      current_round: 3,
      target_rounds: 5,
      stop_requested: false,
    })
    global.fetch = fetchMock

    await predictGetSimulationStatus({ simulationId: 's-1' })

    const [urlArg] = (fetchMock as unknown as { mock: { calls: Array<[URL | string]> } }).mock.calls[0]
    const url = typeof urlArg === 'string' ? urlArg : urlArg.toString()
    expect(url).toBe('http://predict.test:5101/api/simulations/s-1/run-status')
  })

  it('returns the parsed RunTaskState on 200', async () => {
    const payload = {
      id: 'rt-1',
      progress: 0.5,
      status: 'running',
      error: null,
      current_round: 3,
      target_rounds: 5,
      stop_requested: false,
    }
    global.fetch = makeFetchMock(200, payload)

    const result = await predictGetSimulationStatus({ simulationId: 's-1' })
    expect(result).toEqual(payload)
  })

  it('returns null when the server responds 204 No Content', async () => {
    global.fetch = makeFetchMock(204, null, { statusText: 'No Content' })

    const result = await predictGetSimulationStatus({ simulationId: 's-1' })
    expect(result).toBeNull()
  })

  it('throws on missing simulationId', async () => {
    await expect(
      // @ts-expect-error — runtime check.
      predictGetSimulationStatus({}),
    ).rejects.toThrow(/simulationId is required/)
  })

  it('throws on 500', async () => {
    global.fetch = makeFetchMock(500, 'boom', { statusText: 'Internal Server Error' })

    await expect(
      predictGetSimulationStatus({ simulationId: 's-1' }),
    ).rejects.toThrow(/predict_get_simulation_status failed: 500/)
  })
})

// ─── PREDICT_TOOLS registry ───────────────────────────────────────────

describe('PREDICT_TOOLS registry', () => {
  it('exposes exactly the three foundation tools', () => {
    const names = PREDICT_TOOLS.map((t) => t.name).sort()
    expect(names).toEqual([
      'predict_get_report',
      'predict_get_simulation_status',
      'predict_list_projects',
    ])
  })

  it('every tool has a description and an object inputSchema', () => {
    for (const tool of PREDICT_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20)
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.additionalProperties).toBe(false)
    }
  })

  it('marks reportId / simulationId as required where applicable', () => {
    const byName = Object.fromEntries(PREDICT_TOOLS.map((t) => [t.name, t]))
    expect(byName.predict_get_report.inputSchema.required).toEqual(['reportId'])
    expect(byName.predict_get_simulation_status.inputSchema.required).toEqual([
      'simulationId',
    ])
    expect(byName.predict_list_projects.inputSchema.required).toBeUndefined()
  })
})

// ─── dispatchPredictTool ─────────────────────────────────────────────

describe('dispatchPredictTool', () => {
  it('routes predict_list_projects to the list implementation', async () => {
    const fetchMock = makeFetchMock(200, [{ project_id: 'p-1' }])
    global.fetch = fetchMock

    const result = (await dispatchPredictTool('predict_list_projects', {})) as Array<{ project_id: string }>
    expect(result[0].project_id).toBe('p-1')
  })

  it('routes predict_get_report and forwards args', async () => {
    const fetchMock = makeFetchMock(200, { report_id: 'r-9', sections: [] })
    global.fetch = fetchMock

    const result = (await dispatchPredictTool('predict_get_report', {
      reportId: 'r-9',
    })) as { report_id: string }
    expect(result.report_id).toBe('r-9')

    const [urlArg] = (fetchMock as unknown as { mock: { calls: Array<[URL | string]> } }).mock.calls[0]
    const url = typeof urlArg === 'string' ? urlArg : urlArg.toString()
    expect(url).toContain('/api/reports/r-9')
  })

  it('treats null args as empty object', async () => {
    global.fetch = makeFetchMock(200, [])

    await expect(
      dispatchPredictTool('predict_list_projects', null),
    ).resolves.toEqual([])
  })

  it('throws on unknown tool name', async () => {
    await expect(dispatchPredictTool('not_a_tool', {})).rejects.toThrow(
      /Unknown Predict tool: not_a_tool/,
    )
  })
})
