import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { PredictHomeScreen } from '@/screens/predict/predict-home-screen'

export const Route = createFileRoute('/predict')({
  ssr: false,
  component: PredictRoute,
})

function PredictRoute() {
  usePageTitle('Predict')
  return <PredictHomeScreen />
}
