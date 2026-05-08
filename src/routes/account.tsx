import { createFileRoute } from '@tanstack/react-router'

import { AccountScreen } from '@/screens/account/account-screen'

export const Route = createFileRoute('/account')({
  component: AccountScreen,
})
