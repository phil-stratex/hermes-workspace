import { createFileRoute } from '@tanstack/react-router'

import { usePageTitle } from '@/hooks/use-page-title'
import { ErrorsScreen } from '@/screens/errors/errors-screen'

export const Route = createFileRoute('/errors')({
  ssr: false,
  component: ErrorsRoute,
})

function ErrorsRoute() {
  usePageTitle('Errors')
  return <ErrorsScreen />
}
