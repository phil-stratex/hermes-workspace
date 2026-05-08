import { createFileRoute } from '@tanstack/react-router'

import { usePageTitle } from '@/hooks/use-page-title'
import { ErrorDetailScreen } from '@/screens/errors/errors-detail-screen'

export const Route = createFileRoute('/errors/$id')({
  ssr: false,
  component: ErrorsDetailRoute,
})

function ErrorsDetailRoute() {
  usePageTitle('Error Detail')
  return <ErrorDetailScreen />
}
