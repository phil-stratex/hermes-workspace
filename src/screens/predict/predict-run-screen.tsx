import { PhasePlaceholder, PredictShell } from './predict-shell'

export function PredictRunScreen({ simulationId }: { simulationId: string }) {
  return (
    <PredictShell
      step={3}
      title="Predict · Simulation"
      subtitle={`Simulation ${simulationId} — Live-Multi-Agent-Run auf zwei Plattformen`}
    >
      <PhasePlaceholder
        phase="Phase 3 — Dual-Platform Live Simulation (in Arbeit)"
        description="Hier kommt das 2-spaltige Live-Dashboard: 'Info Plaza' (Twitter-Stil) und 'Topic Community' (Reddit-Stil), pro Platform mit Round-Counter, Action-Tooltip-Pills, Posts-Feed und Pause/Stop-Controls."
      />
    </PredictShell>
  )
}
