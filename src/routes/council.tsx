import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { CouncilScreen } from '@/screens/council/council-screen'

export const Route = createFileRoute('/council')({
  ssr: false,
  component: CouncilRoute,
})

function CouncilRoute() {
  usePageTitle('Council')
  return <CouncilScreen />
}
