import { PhasePlaceholder, PredictShell } from './predict-shell'

export function PredictBuildScreen({ projectId }: { projectId: string }) {
  return (
    <PredictShell
      step={1}
      title="Predict · Build"
      subtitle={`Project ${projectId} — Wissensgraph + Persona-Vorbereitung`}
    >
      <PhasePlaceholder
        phase="Phase 1 — Document Upload + GraphRAG (in Arbeit)"
        description="Hier landen ab Phase 1 die Drag-Drop-Zone, der Live-Knowledge-Graph (d3 force layout), und die Ontologie-Build-Progress-SSE-Anzeige. Phase 2 fügt darunter den Environment-Setup-Wizard und die Persona-Stream-Liste an."
      />
    </PredictShell>
  )
}
