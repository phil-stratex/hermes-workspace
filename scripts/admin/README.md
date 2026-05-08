# Admin CLI tools

Tools shipped with the workspace for break-glass operator actions —
recovering a locked-out owner, generating a temp password from the
shell, etc. They are intended to be invoked via `docker exec` inside
the running workspace container, where `HERMES_DATA_DIR` is already
set:

```bash
docker exec -it <workspace-container> tsx scripts/admin/<tool>.ts <args>
```

All tools that mutate state write a `cli_<action>` event to
`data/global/audit/<YYYY-MM-DD>.jsonl` so the action shows up
in the AuditViewer alongside the API-driven events.

## Tools

| Tool | Purpose |
|---|---|
| `confirm-backup-done.ts` | Pre-flight gate for the migration. Sets `data/global/.backup-confirmed` after the operator confirms a Borg snapshot. (Plan-Finding L1 / N6) |
| `confirm-multi-person-tag.ts` | Acknowledge that multiple humans share a stack before the migration tags all gateway sessions to one user. (Plan-Finding L2) |
| `list-users.ts` | Print every user profile as JSON. |
| `list-workspaces.ts` | Print every workspace + its members as JSON. |
| `reset-password.ts` | Generate a new temp password for a user, hash it server-side, return the plaintext on stdout. (Plan-Finding D3 recovery) |
| `promote-to-owner.ts` | Promote a user to `owner` in a workspace (last-owner-aware). |
| `repair-marker.ts` | Reconstruct or repair `migration-completed.json` from `migration-manifest.json`. (Plan-Finding F1) |
