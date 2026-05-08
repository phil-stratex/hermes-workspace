import { createFileRoute } from '@tanstack/react-router'

import { WorkspaceSettingsScreen } from '@/screens/workspace-settings/workspace-settings-screen'

export const Route = createFileRoute('/workspace/$id/settings')({
  component: WorkspaceSettingsScreen,
})
