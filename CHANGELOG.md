# Changelog

All notable changes to Hermes Workspace are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added — Multi-Workspace Stores & Permissions (Phase A.1, 2026-05-08)
- **`src/server/audit-log.ts`** — Hash-chained JSONL Audit-Log mit zwei Scopes (`global` + `{ type: 'workspace', wsId }`). Jeder Eintrag carryt `prevHash` + `thisHash` (sha256 über sortierte Keys), die erste Zeile pro File startet mit `'0'.repeat(64)`. `readAuditChain()` rekomputet die Chain beim Read und gibt `brokenAt` + `breakReason` zurück, sobald ein Eintrag tampered wurde, eine Zeile fehlt oder eine Parse-Failure auftritt — Plan-Finding F10 (UI-Alert beim AuditViewer-Read). Alle Appends laufen via `withMutex` keyed auf den File-Pfad. System-Felder können nicht via Caller-Spread überschrieben werden.
- **`src/server/auth-passwords.ts`** — bcrypt Hash/Verify via `bcryptjs` (pure JS, keine Native-Deps). Cost-Faktor konfigurierbar via `HERMES_BCRYPT_COST` (default 12, clamped auf [10, 14]). `verifyPassword` ist timing-safe und liefert `false` bei korrupten Hashes statt zu werfen. `getCostFromHash()` extrahiert den Cost für künftige Re-Hash-on-Login-Routine. `generateTempPassword()` für Admin PW-Reset (12 Chars, look-alike-freies Alphabet).
- **`src/server/users-store.ts`** — `UserProfile`-CRUD unter `data/users/<userId>/profile.json` mit `schemaVersion: 1`. Failed-Login-Counter (`recordFailedLogin`) atomar via `withMutex(\`user-profile:\${userId}\`)` — Plan-Finding F6 verifiziert mit Test: 50 parallele Calls erzeugen Counter exakt 50, kein Lost-Increment. Lockout bei 10 Fehlversuchen / 15 min, automatisches Auto-Unlock bei `recordSuccessfulLogin`. Password-Hash separat unter `auth/password-hash.txt` (Mode 0600).
- **`src/server/workspace-store.ts`** — `WorkspaceMeta` + `WorkspaceMembers` CRUD mit mtime-invalidiertem In-Memory-Cache → `canDo()` läuft O(1) auf dem Hot-Path (Plan-AK29). Soft-Delete (`deletedAt`) wirkt sofort: nächster Permission-Check sieht Status, Members verlieren Zugang ohne Reload. Last-Owner-Schutz: `removeMember()` und `changeMemberRole()` werfen `cannot remove/demote last owner`. 100 parallele `addMember`-Calls auf disjunkten Users persistieren alle 100 (Race-Test).
- **`src/server/permissions.ts`** — `canDo(userId, wsId, action)` Truth-Table aus Plan A.3 (17 Actions × 3 Rollen). Soft-deleted Workspaces verweigern alles, auch dem Owner. Cross-Workspace-Isolation: Non-Member-User bekommt `false` für alle Actions im fremden Workspace (Plan-Finding F9). `listActionsForUser()` für UI-Rendering der erlaubten Buttons/Menüs.
- **Test-Suite** — 110 neue Vitest-Cases verteilt auf 5 Test-Files. Highlights: 50-parallele-Failed-Login-Race, Audit-Chain-Tampering-Detection (Field-Flip + Line-Deletion), Cross-Workspace-Permission-Denial, Last-Owner-Refusal, Owner-Handover via Promote-then-Demote.

### Changed
- **`bcryptjs@3.0.3`** als Production-Dependency hinzugefügt (für `auth-passwords.ts`). `@types/bcryptjs` als Dev-Dependency.

### Added — Multi-Workspace Foundation (Phase A.0, 2026-05-08)
- **`src/server/data-paths.ts`** — zentrale Pfad-Boundary für den Multi-Workspace-Refactor. Helpers `getDataDir()`, `getWorkspaceDir(id)`, `getUserDir(id)`, `getGlobalDir()`, `getTrashDir()`. Resolution-Order `HERMES_DATA_DIR` → `HERMES_HOME` → `~/.hermes`. Slug-Validation (a-z, 0-9, `-`, max 64 chars) blockiert Path-Traversal-Versuche in `workspaceId` / `userId` zur Konstruktionszeit, nicht erst beim Filesystem-Call.
- **`src/server/sessions-types.ts`** — `FilteredSessions<T>`-Brand-Type über `unique symbol`. Endpoints, die Sessions zurückgeben, deklarieren diesen Return-Type — `tsc` weigert sich dann, Code zu kompilieren, der eine Roh-Session-Liste returnt. `_markAsFiltered()` ist die einzige legale Mint-Funktion und ist nur für `sessions-privacy.ts` (Phase A) gedacht; das Brand kann nicht über Object-Literal geforged werden, weil das Symbol nicht im Aufrufer-Scope ist.
- **`src/server/json-schema-version.ts`** — `assertSchemaVersion(value, expected, fileHint)` für persistierte JSON-Files (`members.json`, `meta.json`, `sessions-meta.json`, `peers.json`, Manifest, …). Wirft `SchemaVersionError` mit klarer Operator-Message bei Mismatch statt silently den falschen Default zu parsen. Akzeptiert auch ein Array erlaubter Versionen für Übergangsphasen.
- **`src/server/migration-marker.ts`** — `migration-completed.json` mit SHA256-self-Checksum + Manifest-Cross-Check (Plan-Finding L4). `isMigrationCompleted()` returnt `true` auch wenn der Marker manuell gelöscht oder korrupt ist, solange `migration-manifest.json` als zweiter Beweis daneben liegt. Verhindert versehentliches Re-Triggern der Migration auf einem bereits umgeformten Stack.
- **Vollständige Test-Suite** — 39 neue Vitest-Cases in `data-paths.test.ts`, `sessions-types.test.ts`, `json-schema-version.test.ts`, `migration-marker.test.ts`, plus zwei N7-Cases in `atomic-write.test.ts`. Coverage inkl. Race-Safety, Tampering, Forging-Attempts und Path-Traversal.

### Changed — Multi-Workspace Foundation (Phase A.0, 2026-05-08)
- **`src/server/atomic-write.ts#withMutex`** mit Self-Cleanup-Finally (Plan-Finding N7) — die interne `mutexChains`-Map droppt einen Slot, sobald die zugehörige Chain settled, aber nur wenn kein neuerer Aufruf den Slot bereits übernommen hat (Identity-Check für Race-Safety). Ohne diesen Patch wuchs die Map monoton, wenn Keys per-Resource unique sind (`snapshot:${wsId}:${sid}` über tausende Sessions). Test: 1000 unique Keys ⇒ `mutexChains.size` zurück auf 0.
- **`_mutexChainsSizeForTests()`** als Test-only Inspector exportiert, damit Unit-Tests den Cleanup-Pfad assertieren können.

### Added — Public hosting via `hermes.stratex-ai.cloud`
- **System nginx site** (`/etc/nginx/sites-enabled/hermes.stratex-ai.cloud`) reverse-proxies to `127.0.0.1:3000` with a Let's-Encrypt cert from Certbot. Replaces the previous SSH-tunnel-only access. Multi-device usable from anywhere.
- **HTTP BasicAuth** in front of the SPA — `auth_basic` middleware reads `/etc/nginx/auth/hermes.htpasswd` (bcrypt, owned by `www-data:www-data`, mode 640). Credentials reuse the existing `ADMIN_USERNAME` + `ADMIN_PASSWORD` from `.env` so there are no new secrets to rotate.
- **HSTS header** — `Strict-Transport-Security: max-age=31536000; includeSubDomains` set on every response.
- **WebSocket upgrade** + 300 s read/send timeouts already present in the nginx site, so Vite HMR + SSE keep working over the public URL.
- **SSH tunnel still works** in parallel — the container's `127.0.0.1:3000:3000` bind is unchanged, so existing tunnels survive.

### Added — GitHub Actions auto-deploy
- **`.github/workflows/deploy-vps.yml`** — on `push` to `stratex/workspace-customizations`, the workflow SSHes into the VPS using a dedicated deploy key (stored as the `VPS_SSH_KEY` repo secret) and triggers a single `deploy.sh` invocation. `concurrency.cancel-in-progress: true` so a faster push overrides an in-flight deploy.
- **Restricted SSH key on VPS** — the deploy public key in `/root/.ssh/authorized_keys` is constrained via `command="/docker/hermes-agent-zjya/deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty`. A leaked key can only trigger a `git pull`; no shell access. Verified — `ssh ... 'rm -rf /'` still just runs `deploy.sh`.
- **`/docker/hermes-agent-zjya/deploy.sh`** — fetches origin, hard-resets to the new tip, and only restarts the workspace container when `routeTree.gen.ts` / `vite.config.ts` / `package.json` / `pnpm-lock.yaml` changed (everything else hot-reloads via Vite). Idempotent — exits early when there's nothing new to pull.

### Fixed — Auto-Rename pipeline (2026-05-08)
- **Server-side title derivation for local sessions** (`src/routes/api/sessions.ts`) — `GET /api/sessions` now passes `gatewaySessions` through `withDerivedLocalTitles()` after `applyStoredTitles()`. For any `source: 'local'` session whose `label`/`title` are still the placeholder (`"Local Chat"` or empty), the first user message is read from `getLocalMessages()` and used as a 50-char-truncated `label`/`title`/`derivedTitle`. The derived title is also persisted via `writeSessionTitle()` so subsequent GETs hit the existing `applyStoredTitles` fast-path. Diagnosed against the live VPS state — all four affected sessions had `title: "Local Chat"` while the frontend's auto-title hook never landed a PATCH (only `ca44cfb6` from May 7 had a stored title). Server-side derivation guarantees a real title on the very next 5 s sidebar refetch, independent of frontend-state races.
- **Auto-rename now triggers for `Session <hex-prefix>` fallbacks** (`src/screens/chat/hooks/use-auto-session-title.ts`) — `GENERIC_TITLE_PATTERNS` was too narrow: a session whose backend title was empty would fall back to `Session fcd3af8a` in the sidebar, but the pattern `^session \d/i` only matched `Session 1`/`Session 42`. Replaced with `^session(\s|$)/i` so any "Session …" string counts as generic. Also added `Local Chat`, `Hermes`, and `Naming…` patterns for completeness.
- **Auto-rename retries after a failed PATCH** (same file, `mutation.onError`) — `lastAttemptRef.current[friendlyId]` is now cleared in the error handler. Without this, a single failed PATCH (network blip, 500, etc.) wedged the hook for the same `(sessionKey, first-message)` pair until a full page reload.
- **Dev-mode trace for auto-rename skip reasons** (same file, `shouldGenerate`) — every short-circuit now `console.debug`s the reason + the relevant inputs in `import.meta.env.DEV`. Production builds are silent. Lets a future "auto-rename didn't fire" report be diagnosed in one minute instead of one hour.

### Fixed — QA-Audit Findings (2026-05-08)
- **Atomic write for the local session cache** (`src/server/local-session-store.ts`) — `saveToDisk()` now goes through `writeJsonAtomic()` (`.tmp` + `rename`) instead of a direct `writeFileSync`. A reader during the write either sees the pre-write or post-write contents — no torn JSON.
- **Subscriber cap on the chat-event bus** (`src/server/chat-event-bus.ts`) — `subscribeToChatEvents` now refuses to register past `MAX_SUBSCRIBERS = 200`, logs a warning, and returns a no-op cleanup. Guards against a leaked SSE handler or a runaway client-reconnect loop silently growing the subscriber set.

### Changed — CI gates
- **CI lint + typecheck no longer swallow failure output** (`.github/workflows/ci.yml`) — the `|| echo "⚠️ ..."` shell fallbacks were removed so real errors surface in the workflow log. `continue-on-error: true` stays on lint/typecheck/test for now (baseline currently has 65 TS errors across 25 files); flag will be dropped once the cleanup pass lands.
- **`pnpm typecheck` script added** (`package.json`) — so CI and contributors can run the same `tsc --noEmit` command without falling back to `pnpm exec`.

### Changed
- **`docker compose up` now pulls pre-built images by default** (#82) — `nousresearch/hermes-agent:latest` for the gateway and `ghcr.io/outsourc-e/hermes-workspace:latest` for the UI. Agent state persists in the `claude-data` named volume. Adds `docker-compose.dev.yml` overlay for building from source.

---

## [Stratex Predict — Hotfix] — 2026-05-08

### Fixed
- **"Simulation starten" failed silently** — re-running an existing simulation crashed in the runner because of a Postgres unique-key collision on `sim_rounds`. Backend hotfix: schema now scopes round numbering by `run_task_id` instead of `simulation_id`, and the prompt feed filters by run_task_id so a restart never reads the previous run's posts. No frontend change required; the existing run-screen now actually starts new runs.

---

## [Stratex / `stratex/workspace-customizations` branch] — 2026-05-08

These entries are specific to the Stratex fork; they are not present in
upstream `outsourc-e/hermes-workspace`.

### Added — Predict feature (5-step multi-agent prediction engine)
- **Sidebar entry "Predict"** with telescope icon, between Council and Settings (desktop + mobile)
- **`/predict`** — home with drag-drop upload (PDF/Markdown/Text, ≤8 files, ≤50 MB total) + free-text prediction prompt + server-driven recent-projects grid (`/api/projects` polled every 15 s) + in-flight resume banner when a build is queued/running
- **`/predict/$projectId/build`** — live SVG knowledge-graph (Fruchterman-Reingold, no d3 dependency) + 3-phase build progress card with ontology preview chips. Once the build flips to completed, a Step-2 section drops in below with an env-setup form (sliders for num_agents 2-50, max_rounds 1-20, platform multi-select) and a live persona-card stream
- **`/predict/$simulationId/run`** — 2-column live dashboard (or 1-column when only one platform is enabled), platform-tone-coded post feeds (sky for Plaza, orange for Community), action ticker with glyphs (✏ post, 💬 reply, ❤ like, ↻ repost), agent-stats table, start/stop controls
- **`/predict/$reportId/report`** — section cards filling in as the LLM finishes each (skeleton → markdown), copy-to-clipboard per section, "Weiter zu Phase 5" surfaces on completion
- **`/predict/$reportId/chat`** — 3-tab interaction surface: ReportAgent chat (knows the report + sim), 1:1 persona chat (dropdown selector), batch survey (multi-select up to 50 personas with one question, live response cards)
- **`/api/predict-proxy/$`** — splat proxy that forwards every `/api/predict-proxy/<path>` request to the `stratex-predict-api` sibling container with `PREDICT_API_TOKEN` server-side injected (browser never sees it). Streams responses unchanged for SSE
- **`predict-tunnel.sh` + `predict-tunnel.bat`** at workspace root — SSH-tunnel helper with `status` / `up` / `down` / `watch` subcommands; auto-recovery for ports 3000/8642/9119
- **`docs/predict.md`** — operator runbook (VPS topology, env vars, common ops, troubleshooting matrix)

### Added — Predict tests
- **34 vitest cases** across reducers (`build-progress`), forms (`upload-dropzone`), hooks (`use-chat-thread` race-protection + persona-keying, `use-build-progress` reset-on-id-change + terminal-state onerror)

### Fixed — Predict UX bugs
- **Chat state lost on tab switch** (F-H1) — chat thread state hoisted from `AgentChatTab`/`PersonaChatTab` onto `PredictInteractionContent` via the new `useChatThread` hook. Switching to another tab and back preserves history.
- **Send-race opening duplicate chats** (F-H2) — `chatIdRef` written synchronously after the first turn returns; rapid double-submit no longer creates two server-side chats.
- **PersonaChat busy state was global** (F-M1) — busy is now keyed by `persona:<id>` so different personas can be in flight in parallel without echo-leaking into the active tab.
- **SSE hooks leaked stale state across IDs** (F-M2) — all five progress hooks (build / prepare / run / report / batch) now `dispatch({type:'reset'})` before subscribing to the new stream. No more flash of the previous project's posts on navigation.
- **Cloudflare-idle close looked like an error** (F-M5) — every `onerror` now reads the cached state ref; if the run already finished (`completed` / `failed` / `stopped`), the connection flips to `closed` instead of `error`. The badge stops red-flagging healthy disconnects.
- **`chunk_failed` was silent** (F-M4) — `BuildProgress` renders a yellow warning pill so partial chunk failures are visible while the build keeps going.
- **Batch survey had no 50-cap in the UI** (F-M3) — `MAX_BATCH_PERSONAS = 50` constant; `selectAll` capped, button disabled past the limit, warning pill when there are more personas than the cap.

### Changed — Predict polish
- Health badge now polls every 30 s via TanStack Query instead of mount-only — backend going down mid-session no longer leaves the dot stuck on green.
- Graph queryKey reduced to `['predict', 'graph', projectId]` — every chunk_done event used to invalidate the cache and trigger a refetch loop.
- KnowledgeGraph ResizeObserver debounced 200 ms — dragging the window edge no longer fires 80-120 force-layout iterations per pixel.
- `predict-store` simplified to the in-memory `pendingUpload` slice; the previously-persisted `recentProjects` cache was replaced by the server-driven list.
- `DEFAULT_PLATFORMS` now a module constant in `predict-run-screen` so `useMemo` reference equality holds across renders.

### Added — Preview-Panel (Artifacts/Canvas, Phase 1)
- **Right-side Preview-Panel** — opens automatically when Hermes writes a file via `write_file`/`edit_file`/`create_file`/`apply_patch` tool calls. Like Claude Artifacts / ChatGPT Canvas. Auto-versioned snapshots per `(sessionId, path)`.
- **Multi-tab UI** — every opened artifact gets a tab; click switches, X closes. Resizable (320–900 px width, persisted via `preview-panel-store.ts`).
- **Inline `<ArtifactCard>`** in chat messages — appears under the tool-activity card whenever a file-write tool ran. Click opens the file in the panel. Color-coded by kind (blue=write, amber=edit, emerald=create, purple=patch).
- **Code-View** — Shiki syntax-highlighting (vitesse-light/dark, dynamic language loading) with line numbers + copy-to-clipboard. Read-only.
- **Markdown-View** — rendered via existing `react-markdown` + `remark-gfm` + `remark-breaks`, toggle to source via the view-mode-switcher.
- **Iframe-View** — `.html` artifacts rendered live in sandboxed iframe (`allow-scripts allow-forms`, no `allow-same-origin`). Auto-injects Tailwind CDN if utility classes detected and no script tag present.
- **Diff-View** — Monaco DiffEditor compares the current version against the previous one for the same path. Read-only, side-by-side. Theme follows `useResolvedTheme()`.
- **History tab** — lists all versions of the active file with timestamps + tool name + size. "View" jumps to that version, "Diff vs latest" opens the diff view.
- **Server-side artifact store** — `src/server/file-artifact-store.ts` persists snapshots to `.runtime/file-artifacts/<sessionId>/<sanitized-slug>__v<n>.json` plus a metadata index. Path-traversal protection rejects `..`, drive prefixes, colons, leading slashes.
- **REST API** — `GET /api/file-artifacts?sessionId=&path=&limit=` (metadata list) and `GET /api/file-artifacts/$artifactId` (full content with diff). Auth pattern mirrors `/api/artifacts`.
- **Streaming hook** — `tryCaptureFileArtifact` in `src/routes/api/send-stream.ts` fires for the four tool-completion paths (portable responses-API, synthetic-poller, vanilla `tool.completed`, `run.completed` backfill). Emits a `'fileArtifact'` SSE event the client routes through `chat-store.processEvent`.
- **Layout** — `src/screens/chat/chat-screen.tsx` grid extended to `auto_minmax(0,1fr)_auto_auto` so `<PreviewPanel />` lives next to `<AgentViewPanel />` without breaking either.

### Added — Project-Runner (Phase 2)
- **Live preview for full-stack projects** — when Hermes scaffolds a Next.js / Vite / Astro / SvelteKit / CRA / static-HTML project, the user clicks "▶ Run" in the Preview-Panel and the Workspace-Container spawns `pnpm install && pnpm dev` inside the Hermes-Container, then proxies `/preview/<runId>/*` to `hermes-agent:<port>` so the iframe shows the running app.
- **Framework detector** (`src/server/framework-detector.ts`) — reads `package.json` deps + `scripts.dev`, falls back to `python3 -m http.server` for static HTML.
- **Port pool** (`src/server/preview-port-pool.ts`) — allocates from `4001-4020`, persists to `.runtime/preview-ports.json` via atomic rename. Throws `PortPoolExhaustedError` when full. In-process async-mutex serializes allocation calls.
- **Project-Runner core** (`src/server/project-runner.ts`) — `startPreview` / `stopPreview` / `getPreviewStatus` / `listRunningPreviews` / `getPreviewLogs`. Health-checks `http://hermes-agent:<port>/` every 1 s for up to 60 s. State mirrored to `.runtime/preview-runs.json`. Uses existing `swarmExec()` helper from `src/server/swarm-docker-exec.ts` to drive the Hermes-Container.
- **Sub-path proxy route** (`src/routes/preview.$runId.$.ts`) — TanStack Start catch-all that forwards every method (GET/POST/PUT/DELETE/PATCH/OPTIONS) to the spawned dev-server. Hop-by-hop headers stripped per RFC 7230 §6.1. Streams body in/out with `duplex: 'half'`.
- **Project registry** (`src/server/preview-projects-registry.ts`) — every `package.json` write is registered (sessionId-keyed) so the frontend can show a "Run App" tab without the user having to remember which folder is the project root.
- **REST API** — `POST /api/preview-runner/start`, `POST /api/preview-runner/stop`, `GET /api/preview-runner/status`, `GET /api/preview-runner/list`, `GET /api/preview-runner/logs?runId=&tail=`, `GET /api/preview-projects?sessionId=`.
- **Frontend Run-App tab** (`src/components/preview-panel/run-app-tab.tsx`) — five states (idle / installing / starting / ready / error). React-Query polls `status` every 2 s while installing/starting; once `ready`, the iframe takes over. Toolbar: refresh, open-in-new-tab, restart, logs drawer, stop.
- **Iframe-View extended** with `mode: 'srcdoc' | 'live'` discriminated union — live mode loads `/preview/<runId>/`, no Tailwind injection (the running app handles its own CSS), more permissive sandbox (`allow-scripts allow-forms allow-popups allow-modals`, still no `allow-same-origin`).
- **VPS deployment guide** (`docs/PHASE_2_DEPLOYMENT.md`, 276 lines) — pre-deploy checklist, `start-all.sh` patch, container-restart cycle, smoke-test walkthrough, known limitations (HMR over sub-path, Next.js `basePath` snippet), cleanup + rollback recipes.

### Fixed — Preview-Panel hardening pass
- **Claude tool names not detected (C4)** — `Write`, `Edit`, `MultiEdit`, `NotebookEdit` (lowercased: `write`, `edit`, `multiedit`, `notebookedit`) added to `FILE_WRITE_TOOL_NAMES_SET`. Without this fix the entire feature was a no-op for the standard Claude code-edit path. Constants centralised in `src/lib/file-artifact-tool-names.ts` (consumed by both server `send-stream.ts` and client `message-item.tsx`).
- **Mobile dead-end click (C6)** — inline `<ArtifactCard>` no longer renders on mobile; the `<PreviewPanel />` itself is desktop-only, so the click would otherwise update store state invisibly.
- **Snippet stored as full file (H3)** — when `str_replace_editor` fires with an `old_str` that doesn't exist in the on-disk file, `tryCaptureFileArtifact` now aborts the capture instead of persisting the snippet as if it were the full file.
- **Concurrent version race (C1)** — `createFileArtifact` now async + per-`(sessionId, path)` async-mutex around version increment + index/content write. Two parallel writes can no longer collide on the same artifact id.
- **Path traversal hardening (C2)** — Windows drive prefixes (`C:\...`) and colon segments rejected; slug regex tightened to `[^a-zA-Z0-9_.-]`. `createFileArtifact` returns `null` instead of throwing on invalid paths.
- **Duplicate artifacts from poller + backfill (C3)** — content-hash dedup keyed on `(sessionId, toolCallId, contentHash)`. The metadata now carries `contentHash` so the dedup check is O(1).
- **Old messages lost their cards on refresh (C5)** — `chat-store.hydrateFileArtifacts(sessionId)` is invoked from `chat-screen.tsx` after history loads. The `fileArtifactsByToolCall` map is rebuilt by listing all artifacts for the session and keeping the latest version per tool-call id.
- **Iframe panel could eat the chat at small viewports (H1/M1)** — `MAX_PANEL_WIDTH = 900` clamp moved into `setPanelWidth`. Resize handle additionally clamps to `min(viewport * 0.6, MAX)` so the panel never takes more than 60 % of viewport.
- **LCS table OOM at 4000×4000 (H6)** — diff cap reduced to 1500 lines, switched to `Uint16Array` (≈ 4.5 MB instead of ≈ 128 MB). Above the cap, `diff` is left `undefined` instead of fabricating an "all-old / all-new" stand-in.
- **`index.json` corruption silently wiped data (H7)** — saves are now `.tmp` + `renameSync`. On `JSON.parse` failure, the corrupt file is copied to `index.json.corrupt-<timestamp>` before the in-memory state resets.
- **Cross-store error swallowed silently (H4)** — `usePreviewPanelStore.getState().openArtifact()` failures (e.g. `crypto.randomUUID` unavailable) now log via `console.error` instead of being swallowed.
- **`fileArtifact` events missed the activity feed (H8)** — `pushActivity({ type: 'fileArtifact', ... })` now mirrors the existing `'artifact'` case in `use-streaming-message.ts`.
- **Resize-handle pointer cleanup (H5)** — removed misleading `dragStateRef.pointerId` (it was `event.button`, not a pointer id). Added `pointercancel` listener so alt-tabbing mid-drag cleans up.
- **Version switch lost tool-name badge (M2)** — `updateTabVersion` now also accepts `toolName` and `kind`; the History tab passes them so the tab badge stays accurate after restoring an older version.
- **Lint pass on Phase-1 files** — auto-fixed import-order + sort-imports issues; manually fixed shadowed `handleResizeStart`, redundant `if (activeTab)` checks (covered by an earlier `tabs.length === 0` guard), and silenced two intentional defensive null-checks with reason comments.
- **JSDoc header blocks stripped** from preview-panel files to match project's "default to no comments" policy.

---

## [2.0.0] — 2026-04-20

**Zero-fork release.** Clone, don't fork. Hermes Workspace now runs on vanilla `pip install hermes-agent` with no patches, no drift, no custom gateway required.

### Added
- **Zero-fork architecture** — dual gateway/dashboard routing; workspace talks directly to vanilla `hermes-agent` 0.10.0+ via standard endpoints (`/v1/models`, `/api/sessions`, `/api/skills`, `/api/config`, `/api/jobs`)
- **One-liner curl installer** — `curl -fsSL … | bash` provisions workspace + gateway + defaults
- **Claude-Nous theme** — dark + light editorial variants with cobalt/paper surface pass, thin 1px architectural borders, editorial type accents
- **Conductor** (`/conductor`) — mission-control surface ported from Clawsuite; spawn missions, assign workers, watch live output and costs
- **Operations** (`/operations`) — agent registry / sessions manager ported from Clawsuite; pause, steer, kill live agents with role and model insight
- **Synthesized tool pills** — inline tool-call rendering from dashboard stream markers when running against zero-fork gateway
- **Landing parity pass** — hero, features, screenshots, setup, OG image, mobile theme toggle
- **Task board status vs. assignee** decoupling
- **Local-model chat session persistence** — local sessions appear in history + session list
- **Memory is local-fs first** — honors `HERMES_HOME`, no gateway dependency
- **Splash + screenshots refresh** — Conductor, Dashboard, Tasks, Jobs captured in new editorial theme

### Changed
- **Model picker** — fetches from gateway (`~/.hermes/models.json` for user-configured models), matches OCPlatform behavior; shows only configured providers instead of all upstream
- **`enhanced-fork` mode label** no longer implies a fork is required; it indicates streaming route availability on vanilla gateway
- **Dashboard + enhanced-chat capabilities** marked optional; missing endpoints no longer trigger warnings
- **Feature-gate + install copy** — all fork-era references purged
- **Theme family allowlist** — `claude-nous` promoted to the enterprise allowlist
- **Session pill** — solid dark-mode background, matches model selector

### Fixed
- Duplicate responses and disappearing history on interrupt (#62)
- Portable-mode double user message, uncleaned timeouts, orphaned unregister callbacks
- Local model selection actually propagates to chat (no silent fallback)
- Strip provider prefix correctly for local routing
- Dashboard token injection on `/` (not `/index.html`)
- Onboarding no longer stacks behind workspace shell
- Root bootstrap guards against uncaught errors
- Preserve assistant text during tool-call streaming
- Installer output uses defined escape vars (removed undefined BOLD/RESET)

### Removed
- All references to the legacy "enhanced fork" as a requirement
- Stale fork-era gateway instructions and feature-gate copy

---

## [1.0.0] — 2026-04-10

Initial public release. Chat, files, memory, skills, terminal, dashboard, settings — the foundational workspace.
