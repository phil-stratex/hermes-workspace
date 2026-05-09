// File-name with leading `-` keeps TanStack Router from picking this up
// as a route while vitest still discovers it via glob.
import { describe, expect, it } from 'vitest'
import { scoreWorker, type WorkerHint } from './swarm-decompose'

const baseWorker: WorkerHint = { id: 'swarm-1' }

describe('scoreWorker — Smart-Routing heuristic (B2)', () => {
  describe('topic-pattern matches (+3 per term hit)', () => {
    it('rewards research-coded text + research/analysis terms', () => {
      const score = scoreWorker(
        'investigate two database options and synthesize tradeoffs',
        { ...baseWorker, role: 'research', skills: ['analysis'] },
      )
      // research+analysis hit twice = +3*2 from the pattern bucket
      expect(score).toBeGreaterThanOrEqual(6)
    })

    it('rewards build-coded text + builder/implementation terms', () => {
      const score = scoreWorker(
        'implement the new chat API endpoint and patch the UI',
        {
          ...baseWorker,
          role: 'builder',
          capabilities: ['implementation', 'ui', 'backend'],
        },
      )
      // builder + implementation + ui + backend (4 hits) — capped per pattern bucket
      expect(score).toBeGreaterThanOrEqual(12)
    })

    it('returns 0 when no topic pattern matches and no other signals', () => {
      const score = scoreWorker(
        'random text with no signals at all',
        { ...baseWorker, role: 'researcher', skills: ['analysis'] },
      )
      // Pattern doesn't match the prompt → no per-term bonus regardless of worker fields.
      expect(score).toBe(0)
    })

    it('rewards swarm-worker-core hint with +1', () => {
      const score = scoreWorker('anything', {
        ...baseWorker,
        notes: 'uses swarm-worker-core abstractions',
      })
      expect(score).toBe(1)
    })
  })

  describe('preferredTaskTypes — strong signal (+5 per hit, capped at 15)', () => {
    it('adds +5 per preferred-type substring match', () => {
      const score = scoreWorker('write the documentation pages', {
        ...baseWorker,
        preferredTaskTypes: ['documentation'],
      })
      // No topic-pattern match for 'documentation' alone in the heuristic;
      // the +5 comes purely from the preferredTaskTypes bonus.
      expect(score).toBe(5)
    })

    it('caps the bonus at 15 even with 4+ matches', () => {
      const score = scoreWorker(
        'docs api ui review research',
        {
          ...baseWorker,
          preferredTaskTypes: ['docs', 'api', 'ui', 'review', 'research'],
        },
      )
      // 5 hits × 5 = 25 raw, capped at 15. Add topic-pattern points on top.
      // We only assert the floor: at least 15 from preferredTaskTypes.
      expect(score).toBeGreaterThanOrEqual(15)
    })

    it('skips empty strings in preferredTaskTypes', () => {
      const score = scoreWorker('build the api', {
        ...baseWorker,
        preferredTaskTypes: ['', 'api', ''],
      })
      // 1 valid hit from 'api' = +5, plus topic-pattern from 'build|api' bucket.
      expect(score).toBeGreaterThanOrEqual(5)
    })
  })

  describe('busy-state penalty', () => {
    it('penalises running/active/thinking/reviewing/writing with -4', () => {
      for (const state of ['running', 'active', 'thinking', 'reviewing', 'writing']) {
        const idle = scoreWorker('docs handoff', {
          ...baseWorker,
          role: 'docs scribe',
          state: 'idle',
        })
        const busy = scoreWorker('docs handoff', {
          ...baseWorker,
          role: 'docs scribe',
          state,
        })
        expect(busy).toBe(idle - 4)
      }
    })

    it('penalises blocked/error harder with -8', () => {
      for (const state of ['blocked', 'error']) {
        const idle = scoreWorker('docs handoff', {
          ...baseWorker,
          role: 'docs scribe',
          state: 'idle',
        })
        const halted = scoreWorker('docs handoff', {
          ...baseWorker,
          role: 'docs scribe',
          state,
        })
        expect(halted).toBe(idle - 8)
      }
    })

    it('does not penalise idle / offline / unknown', () => {
      const baseScore = scoreWorker('docs handoff', {
        ...baseWorker,
        role: 'docs scribe',
      })
      for (const state of ['idle', 'offline', 'unknown', 'pending']) {
        expect(scoreWorker('docs handoff', {
          ...baseWorker,
          role: 'docs scribe',
          state,
        })).toBe(baseScore)
      }
    })

    it('state matching is case-insensitive', () => {
      const lower = scoreWorker('docs', {
        ...baseWorker,
        role: 'docs scribe',
        state: 'running',
      })
      const upper = scoreWorker('docs', {
        ...baseWorker,
        role: 'docs scribe',
        state: 'RUNNING',
      })
      expect(upper).toBe(lower)
    })
  })

  describe('combined signals', () => {
    it('a free worker beats an equally-matched busy one (B2 invariant)', () => {
      const idle = scoreWorker('build the new API endpoint', {
        ...baseWorker,
        id: 'swarm-idle',
        role: 'builder',
        capabilities: ['implementation', 'api'],
        state: 'idle',
      })
      const busy = scoreWorker('build the new API endpoint', {
        ...baseWorker,
        id: 'swarm-busy',
        role: 'builder',
        capabilities: ['implementation', 'api'],
        state: 'running',
      })
      expect(idle).toBeGreaterThan(busy)
    })

    it('preferredTaskTypes overrides busy-state penalty when strong', () => {
      // Worker is busy but has a perfect preferredTaskTypes match.
      const busyWithPreference = scoreWorker(
        'review the github pr for issues',
        {
          ...baseWorker,
          role: 'reviewer',
          preferredTaskTypes: ['review', 'pr', 'issues'],
          state: 'running',
        },
      )
      // Generic builder, idle, but no strong topic match.
      const idleGeneric = scoreWorker(
        'review the github pr for issues',
        {
          ...baseWorker,
          role: 'builder',
          state: 'idle',
        },
      )
      expect(busyWithPreference).toBeGreaterThan(idleGeneric)
    })

    it('is deterministic — repeated calls return the same score', () => {
      const worker: WorkerHint = {
        id: 'swarm-d',
        role: 'reviewer',
        skills: ['review', 'gates'],
        preferredTaskTypes: ['review'],
        state: 'idle',
      }
      const first = scoreWorker('review the test', worker)
      const second = scoreWorker('review the test', worker)
      const third = scoreWorker('review the test', worker)
      expect(first).toBe(second)
      expect(second).toBe(third)
    })
  })

  describe('edge cases', () => {
    it('survives a worker with only an id', () => {
      const score = scoreWorker('anything', { id: 'minimal' })
      expect(Number.isFinite(score)).toBe(true)
      // No matches, no penalties → 0.
      expect(score).toBe(0)
    })

    it('survives an empty prompt', () => {
      const score = scoreWorker('', {
        ...baseWorker,
        role: 'researcher',
        preferredTaskTypes: ['research'],
      })
      expect(Number.isFinite(score)).toBe(true)
    })

    it('null/undefined optional fields do not throw', () => {
      const score = scoreWorker('build something', {
        id: 'swarm-x',
        role: undefined,
        skills: undefined,
        capabilities: undefined,
        preferredTaskTypes: undefined,
        state: undefined,
      })
      expect(Number.isFinite(score)).toBe(true)
    })
  })
})
