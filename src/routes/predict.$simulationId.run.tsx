import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { PredictRunScreen } from '@/screens/predict/predict-run-screen'

export const Route = createFileRoute('/predict/$simulationId/run')({
  ssr: false,
  component: PredictRunRoute,
})

function PredictRunRoute() {
  const { simulationId } = Route.useParams()
  usePageTitle(`Predict · Simulation`)
  return <PredictRunScreen simulationId={simulationId} />
}
