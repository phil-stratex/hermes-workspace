import { PhasePlaceholder, PredictShell } from './predict-shell'

export function PredictReportScreen({ reportId }: { reportId: string }) {
  return (
    <PredictShell
      step={4}
      title="Predict · Report"
      subtitle={`Report ${reportId} — ReportAgent-Analyse, Live-Markdown-Streaming`}
    >
      <PhasePlaceholder
        phase="Phase 4 — Report Generation (in Arbeit)"
        description="Hier streamt der ReportAgent in Phase 4 die Markdown-Sektionen live ein (Executive Summary, Methodology, Findings, Recommendations) — links Sektions-Liste, rechts Workflow-Timeline plus Tool-Call-Trace."
      />
    </PredictShell>
  )
}
