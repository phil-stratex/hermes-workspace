import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { PredictReportScreen } from '@/screens/predict/predict-report-screen'

export const Route = createFileRoute('/predict/$reportId/report')({
  ssr: false,
  component: PredictReportRoute,
})

function PredictReportRoute() {
  const { reportId } = Route.useParams()
  usePageTitle(`Predict · Report`)
  return <PredictReportScreen reportId={reportId} />
}
