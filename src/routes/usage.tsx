import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { UsageScreen } from '@/screens/usage/usage-screen'

export const Route = createFileRoute('/usage')({
  ssr: false,
  component: UsageRoute,
})

function UsageRoute() {
  usePageTitle('Usage')
  return <UsageScreen />
}
