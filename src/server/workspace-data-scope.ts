/**
 * Workspace-scope helper for routes whose underlying data sources are
 * still globally rooted (Hermes-agent-managed: `~/.openclaw/`,
 * `HERMES_HOME/sessions/`, repo-rooted `swarm.yaml`, etc.).
 *
 * Until those data sources are physically partitioned per-workspace,
 * we enforce a soft boundary: the **migration-default** workspace sees
 * the legacy data (which is what migrated to it during Phase A), and
 * every other workspace sees an empty response. This makes a freshly
 * created workspace appear truly empty (no leaked Stratex history) at
 * the cost of any new workspace not having Hermes-agent data of its
 * own — that's intentional until the storage layer is wsId-keyed.
 *
 * Future plan: each helper called by these routes accepts `wsId` and
 * resolves to `data/workspaces/<wsId>/...`, with the migration-default
 * workspace pointing its symlinks at the legacy paths for back-compat.
 */

const DEFAULT_WORKSPACE_ID =
  process.env.DEFAULT_WORKSPACE_ID ?? 'stratex'

/**
 * True when the given workspace is the migration-default and therefore
 * owns the legacy global data store. Returns false for any new
 * workspace (Plan B, Plan C, …) created after the Phase A migration.
 */
export function isLegacyDataWorkspace(wsId: string | null | undefined): boolean {
  return typeof wsId === 'string' && wsId === DEFAULT_WORKSPACE_ID
}

/**
 * Same as `isLegacyDataWorkspace` but explicit for documentation —
 * route handlers call this to decide whether to read the global path
 * or short-circuit to an empty response.
 */
export function shouldReturnLegacyData(wsId: string | null | undefined): boolean {
  return isLegacyDataWorkspace(wsId)
}

export { DEFAULT_WORKSPACE_ID }
