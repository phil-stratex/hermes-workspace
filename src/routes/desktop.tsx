import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { DesktopScreen } from '@/screens/desktop/desktop-screen'

export const Route = createFileRoute('/desktop')({
  ssr: false,
  component: DesktopRoute,
})

function DesktopRoute() {
  usePageTitle('Desktop')
  return <DesktopScreen />
}
