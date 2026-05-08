/**
 * Live knowledge-graph viewer.
 *
 * Renders a force-directed-style SVG without pulling in d3 or
 * react-force-graph — for graph sizes the build phase emits (typically
 * 20-200 nodes) a self-contained 60-line layout is plenty. We re-run a
 * lightweight Fruchterman-Reingold simulation whenever the snapshot
 * changes, then animate node positions via CSS transitions.
 *
 * Click a node to inspect; selection lifts to the parent so the build
 * screen can show a side-panel with the full summary.
 */

import { useEffect, useMemo, useState } from 'react'
import type { GraphEdge, GraphNode } from '@/server/predict-client'
import { cn } from '@/lib/utils'

const TYPE_COLORS: Record<string, string> = {
  stakeholder: '#60a5fa',
  person: '#60a5fa',
  organization: '#a78bfa',
  policy: '#34d399',
  event: '#f59e0b',
  concept: '#9ca3af',
  trend: '#f472b6',
  technology: '#22d3ee',
  location: '#fb923c',
}

function colorFor(entityType: string): string {
  return TYPE_COLORS[entityType.toLowerCase()] ?? '#9ca3af'
}

type Pos = { x: number; y: number; vx: number; vy: number }

function simulate(
  nodes: Array<GraphNode>,
  edges: Array<GraphEdge>,
  width: number,
  height: number,
): Map<string, Pos> {
  const positions = new Map<string, Pos>()
  if (nodes.length === 0) return positions

  // Initial positions on a circle so the simulation has a sane starting state.
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) * 0.35
  nodes.forEach((node, i) => {
    const angle = (i / nodes.length) * Math.PI * 2
    positions.set(node.id, {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    })
  })

  const k = Math.sqrt((width * height) / Math.max(1, nodes.length)) * 0.7
  const iterations = nodes.length < 50 ? 80 : 120

  for (let iter = 0; iter < iterations; iter++) {
    const t = 1 - iter / iterations
    // Repulsive forces — every-node-pair (O(n²) is fine at n≤200).
    for (const a of nodes) {
      const pa = positions.get(a.id)!
      pa.vx = 0
      pa.vy = 0
      for (const b of nodes) {
        if (a.id === b.id) continue
        const pb = positions.get(b.id)!
        const dx = pa.x - pb.x
        const dy = pa.y - pb.y
        const d2 = dx * dx + dy * dy + 0.01
        const factor = (k * k) / d2
        pa.vx += dx * factor
        pa.vy += dy * factor
      }
    }
    // Attractive forces along edges.
    for (const edge of edges) {
      const pa = positions.get(edge.src_id)
      const pb = positions.get(edge.dst_id)
      if (!pa || !pb) continue
      const dx = pa.x - pb.x
      const dy = pa.y - pb.y
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01
      const factor = (d * d) / k
      pa.vx -= (dx / d) * factor
      pa.vy -= (dy / d) * factor
      pb.vx += (dx / d) * factor
      pb.vy += (dy / d) * factor
    }
    // Apply velocities with damping.
    for (const node of nodes) {
      const p = positions.get(node.id)!
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy) + 0.01
      const limit = Math.min(speed, 8 * t * 50) / speed
      p.x += p.vx * limit
      p.y += p.vy * limit
      // Keep inside the canvas with a small padding.
      p.x = Math.max(30, Math.min(width - 30, p.x))
      p.y = Math.max(30, Math.min(height - 30, p.y))
    }
  }

  return positions
}

export type GraphSelection = { nodeId: string; node: GraphNode } | null

export function KnowledgeGraphPanel({
  nodes,
  edges,
  selection,
  onSelect,
  emptyHint,
}: {
  nodes: Array<GraphNode>
  edges: Array<GraphEdge>
  selection: GraphSelection
  onSelect: (next: GraphSelection) => void
  emptyHint?: string
}) {
  const [size, setSize] = useState({ width: 600, height: 480 })
  const containerRef = useResizeRef(setSize)

  const positions = useMemo(
    () => simulate(nodes, edges, size.width, size.height),
    [nodes, edges, size.width, size.height],
  )

  return (
    <div
      ref={containerRef}
      className="relative h-[480px] overflow-hidden rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)]"
    >
      {nodes.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-[var(--theme-muted)]">
          {emptyHint ?? 'Knoten erscheinen sobald der Wissensgraph aufgebaut wird.'}
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${size.width} ${size.height}`}
          width="100%"
          height="100%"
          aria-label="Knowledge graph"
        >
          <g>
            {edges.map((edge) => {
              const a = positions.get(edge.src_id)
              const b = positions.get(edge.dst_id)
              if (!a || !b) return null
              const isSelectedNeighbour =
                selection != null && (edge.src_id === selection.nodeId || edge.dst_id === selection.nodeId)
              return (
                <line
                  key={edge.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={isSelectedNeighbour ? 'var(--theme-accent)' : 'var(--theme-border)'}
                  strokeWidth={isSelectedNeighbour ? 1.5 : 0.8}
                  strokeOpacity={isSelectedNeighbour ? 0.9 : 0.55}
                />
              )
            })}
          </g>
          <g>
            {nodes.map((node) => {
              const p = positions.get(node.id)
              if (!p) return null
              const isSelected = selection?.nodeId === node.id
              const fill = colorFor(node.entity_type)
              return (
                <g
                  key={node.id}
                  transform={`translate(${p.x},${p.y})`}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelect(isSelected ? null : { nodeId: node.id, node })
                  }}
                >
                  <circle
                    r={isSelected ? 10 : 7}
                    fill={fill}
                    stroke={isSelected ? 'var(--theme-text)' : 'var(--theme-bg)'}
                    strokeWidth={isSelected ? 2 : 1.5}
                  />
                  <text
                    x={12}
                    y={4}
                    fontSize={11}
                    fill="var(--theme-text)"
                    style={{ pointerEvents: 'none' }}
                  >
                    {truncate(node.name, 28)}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      )}

      {selection ? (
        <aside
          className="absolute right-3 top-3 max-w-xs rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-3 text-xs shadow-lg"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold">{selection.node.name}</div>
              <div className="text-[10px] uppercase text-[var(--theme-muted)]">
                {selection.node.entity_type}
              </div>
            </div>
            <button
              type="button"
              className="text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
              onClick={() => onSelect(null)}
              aria-label="Close detail"
            >
              ×
            </button>
          </div>
          {selection.node.summary ? (
            <p className="mt-2 text-[var(--theme-muted)]">{selection.node.summary}</p>
          ) : null}
        </aside>
      ) : null}

      <div className="absolute bottom-2 left-3 flex flex-wrap items-center gap-2 text-[10px] text-[var(--theme-muted)]">
        <span>{nodes.length} Knoten</span>
        <span>·</span>
        <span>{edges.length} Kanten</span>
      </div>
    </div>
  )
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function useResizeRef(setSize: (s: { width: number; height: number }) => void) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setSize({ width: Math.max(280, rect.width), height: Math.max(320, rect.height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [el, setSize])
  return setEl
}
