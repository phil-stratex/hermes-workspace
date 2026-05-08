import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { PredictInteractionScreen } from '@/screens/predict/predict-interaction-screen'

export const Route = createFileRoute('/predict/$reportId/chat')({
  ssr: false,
  component: PredictInteractionRoute,
})

function PredictInteractionRoute() {
  const { reportId } = Route.useParams()
  usePageTitle(`Predict · Interaction`)
  return <PredictInteractionScreen reportId={reportId} />
}
