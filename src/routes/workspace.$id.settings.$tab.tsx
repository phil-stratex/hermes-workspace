import { createFileRoute } from '@tanstack/react-router'

import { WorkspaceGeneralTab } from '@/screens/workspace-settings/general-tab'
import { WorkspaceMembersTab } from '@/screens/workspace-settings/members-tab'
import { WorkspaceRosterTab } from '@/screens/workspace-settings/roster-tab'
import { WorkspaceFederationTab } from '@/screens/workspace-settings/federation-tab'
import { WorkspaceAuditTab } from '@/screens/workspace-settings/audit-tab'

export const Route = createFileRoute('/workspace/$id/settings/$tab')({
  component: TabPage,
})

function TabPage() {
  const { tab } = Route.useParams()
  switch (tab) {
    case 'general':    return <WorkspaceGeneralTab />
    case 'members':    return <WorkspaceMembersTab />
    case 'roster':     return <WorkspaceRosterTab />
    case 'federation': return <WorkspaceFederationTab />
    case 'audit':      return <WorkspaceAuditTab />
    default:
      return (
        <div className="px-6 py-12 text-center text-primary-600">
          Tab „{tab}" unbekannt.
        </div>
      )
  }
}
