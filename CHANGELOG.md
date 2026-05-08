# Changelog

All notable changes to Hermes Workspace are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed
- **`docker compose up` now pulls pre-built images by default** (#82) — `nousresearch/hermes-agent:latest` for the gateway and `ghcr.io/outsourc-e/hermes-workspace:latest` for the UI. Agent state persists in the `claude-data` named volume. Adds `docker-compose.dev.yml` overlay for building from source.

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
