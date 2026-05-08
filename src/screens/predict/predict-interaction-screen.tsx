import { PhasePlaceholder, PredictShell } from './predict-shell'

export function PredictInteractionScreen({ reportId }: { reportId: string }) {
  return (
    <PredictShell
      step={5}
      title="Predict · Interaction"
      subtitle={`Report ${reportId} — Chat mit ReportAgent oder Personas, Batch-Survey`}
    >
      <PhasePlaceholder
        phase="Phase 5 — Interaction (in Arbeit)"
        description="Hier kommen drei Tabs: (1) Chat mit ReportAgent inkl. Tool-Call-Anzeige, (2) Chat mit einzelnen Personas, (3) Batch-Survey: gleichzeitig N Personas dieselbe Frage stellen und Antworten als Tabelle anzeigen."
      />
    </PredictShell>
  )
}
