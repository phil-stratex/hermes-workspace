export type WorkspaceScope = {
  path?: string
  folderName?: string
  isValid?: boolean
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Stratex: capability summary injected alongside the workspace_context tag so
 * Aurora (and any other LLM consuming this message) knows what surfaces the
 * Hermes Workspace offers — and can actively use them.
 *
 * Keep this list short and option-shaped (describe what's possible, not what
 * "will happen"). Each line is read fresh on every chat send; bloat = token
 * cost on every turn.
 */
const WORKSPACE_CAPABILITIES_BLOCK = [
  '<workspace_capabilities>',
  "- auto-preview-html: HTML files written via tool-call appear automatically in the user's preview panel (rendered, not as code). Prefer HTML for visual dashboards, reports, or demos rather than plain markdown.",
  "- desktop-vnc: A live noVNC view of an OpenHands sandbox desktop is embedded as the /desktop route AND as a togglable side-panel in chat. When a task needs real browser work (visit URL, screenshot, click through a flow), dispatch swarm9 Designer or swarm7 QA which have the 'openhands' skill — they drive the desktop and the user watches live.",
  "- swarm-dispatch: 10 named workers (swarm1..swarm10) coordinated by swarm3 Mirror. POST /api/swarm-dispatch for multi-worker tasks. Each worker has Stratex identity + role + skills.",
  '</workspace_capabilities>',
].join('\n')

export function buildWorkspaceDirective(workspace: WorkspaceScope): string {
  const path = workspace.path?.trim() ?? ''
  if (!path || workspace.isValid === false) return ''
  const name = workspace.folderName?.trim() || path.split('/').filter(Boolean).at(-1) || 'workspace'
  return [
    `<workspace_context active="true" name="${escapeAttribute(name)}" path="${escapeAttribute(path)}" />`,
    WORKSPACE_CAPABILITIES_BLOCK,
  ].join('\n')
}

export function buildWorkspaceScopedTextMessage(
  message: string,
  workspace: WorkspaceScope | null | undefined,
): string {
  if (message.includes('<workspace_context active="true"')) return message
  const directive = workspace ? buildWorkspaceDirective(workspace) : ''
  if (!directive) return message
  return `${directive}\n\n${message}`
}
