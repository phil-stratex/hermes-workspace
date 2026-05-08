import { useEffect, useReducer, useState } from 'react'
import type { ReportEvent } from '@/server/predict-client'
import { predictClient } from '@/server/predict-client'

export type ReportSectionState = {
  slug: string
  title: string
  ordering: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  content: string
  error: string | null
}

export type ReportProgressState = {
  status: 'idle' | 'queued' | 'running' | 'completed' | 'failed' | string
  error: string | null
  totalSections: number
  completedSections: number
  failedSections: number
  sections: Array<ReportSectionState>
}

const initial: ReportProgressState = {
  status: 'idle',
  error: null,
  totalSections: 0,
  completedSections: 0,
  failedSections: 0,
  sections: [],
}

function ensureSection(state: ReportProgressState, slug: string, title: string, ordering: number) {
  const existing = state.sections.find((s) => s.slug === slug)
  if (existing) return state.sections
  const next: ReportSectionState = { slug, title, ordering, status: 'pending', content: '', error: null }
  return [...state.sections, next].sort((a, b) => a.ordering - b.ordering)
}

function patchSection(
  sections: Array<ReportSectionState>,
  slug: string,
  patch: Partial<ReportSectionState>,
): Array<ReportSectionState> {
  return sections.map((s) => (s.slug === slug ? { ...s, ...patch } : s))
}

function reduceReportEvent(state: ReportProgressState, event: ReportEvent): ReportProgressState {
  switch (event.type) {
    case 'snapshot':
      return {
        ...state,
        status: event.status,
        error: event.error ?? null,
      }
    case 'started': {
      // Pre-populate the section list with placeholders so the UI shows
      // skeleton cards immediately (the order arrives via SECTIONS spec).
      const sections = event.section_slugs.map<ReportSectionState>((slug, idx) => ({
        slug,
        title: state.sections.find((s) => s.slug === slug)?.title ?? slug,
        ordering: idx,
        status: 'pending',
        content: '',
        error: null,
      }))
      return {
        ...state,
        status: 'running',
        totalSections: event.section_slugs.length,
        sections,
      }
    }
    case 'section_start': {
      const sections = ensureSection(state, event.slug, event.title, event.ordering)
      return {
        ...state,
        sections: patchSection(sections, event.slug, {
          title: event.title,
          ordering: event.ordering,
          status: 'running',
        }),
      }
    }
    case 'section_done': {
      const sections = ensureSection(state, event.slug, event.title, event.ordering)
      return {
        ...state,
        completedSections: state.completedSections + 1,
        sections: patchSection(sections, event.slug, {
          title: event.title,
          ordering: event.ordering,
          status: 'completed',
          content: event.content,
        }),
      }
    }
    case 'section_failed':
      return {
        ...state,
        failedSections: state.failedSections + 1,
        sections: patchSection(state.sections, event.slug, {
          status: 'failed',
          error: event.error,
        }),
      }
    case 'done':
      return {
        ...state,
        status: 'completed',
        totalSections: event.stats.total,
        completedSections: event.stats.completed,
        failedSections: event.stats.failed,
      }
    case 'failed':
      return { ...state, status: 'failed', error: event.error }
    case 'end':
      return state
    default:
      return state
  }
}

export type ReportConnection = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export function useReportProgress(reportId: string | null): {
  state: ReportProgressState
  connection: ReportConnection
  reconnect: () => void
} {
  const [state, dispatch] = useReducer(reduceReportEvent, initial)
  const [connection, setConnection] = useState<ReportConnection>('idle')
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!reportId) {
      setConnection('idle')
      return
    }
    setConnection('connecting')
    const source = predictClient.openReportEventStream(reportId)
    source.addEventListener('open', () => setConnection('open'))

    const handler = (kind: string) => (raw: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(raw.data) as ReportEvent
        if (!('type' in parsed) || typeof parsed.type !== 'string') {
          ;(parsed as { type: string }).type = kind
        }
        dispatch(parsed)
      } catch {
        /* swallow */
      }
    }
    const eventTypes = [
      'snapshot',
      'started',
      'section_start',
      'section_done',
      'section_failed',
      'done',
      'failed',
      'end',
    ] as const
    for (const kind of eventTypes) {
      source.addEventListener(kind, handler(kind) as EventListener)
    }

    source.onerror = () => {
      setConnection((current) => (current === 'open' ? 'error' : current))
    }

    return () => {
      source.close()
      setConnection('closed')
    }
  }, [reportId, generation])

  return {
    state,
    connection,
    reconnect: () => setGeneration((g) => g + 1),
  }
}
