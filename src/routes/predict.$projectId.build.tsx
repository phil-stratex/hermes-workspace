import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { PredictBuildScreen } from '@/screens/predict/predict-build-screen'

export const Route = createFileRoute('/predict/$projectId/build')({
  ssr: false,
  component: PredictBuildRoute,
})

function PredictBuildRoute() {
  const { projectId } = Route.useParams()
  usePageTitle(`Predict · Build`)
  return <PredictBuildScreen projectId={projectId} />
}
