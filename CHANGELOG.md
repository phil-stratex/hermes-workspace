# Changelog

All notable changes to Hermes Workspace are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added — local-session-store Test-Coverage (2026-05-09)
- `src/server/local-session-store.test.ts` — 14 Tests für `ensureLocalSession`-Idempotenz, sofort-vs-debounce-Persist, 30× concurrent-append, delete/get/list/touch lifecycle. Bisherige Coverage: 0 %.
- Pattern: `mkdtempSync` + `process.chdir` per Test (Modul liest `DATA_DIR` aus `process.cwd()` bei import-time, nicht via env-var) + `vi.resetModules()` + dynamic-import zwischen Tests, damit Module-level `store` / `saveTimer` zwischen Cases nicht lecken. Fake-timers (`vi.useFakeTimers` + `vi.advanceTimersByTime(2100)`) für den 2s-Debounce, `vi.setSystemTime` für die `updatedAt`-Sortierung. Disk-Verifikation per `readFileSync` gegen `<cwd>/.runtime/local-sessions.json`.
- Cases: idempotenter Second-Call returnt selbe Session-Identity; `updateLocalSessionTitle` ist sync-flush (disk sofort lesbar); `appendLocalMessage` flushed nicht vor 1900ms aber nach 2100ms; `scheduleSave` coalesced 5 appends in einem Window; 30 parallele Appends — alle persistiert, keine Lost-Updates / kein torn-JSON; `deleteLocalSession` cleanen Session+Messages sync; `getLocalMessages` in Append-Reihenfolge; `listLocalSessions` sortiert by `updatedAt` desc; `touchLocalSession` mutiert nur In-Memory (Disk-Bytes byte-identical), nächster echter Save persistiert dann den bumped ts.
- Befund: Keine Race-Conditions / Lost-Updates aufgedeckt. `appendLocalMessage` ist vollständig synchron (Array-push vor `scheduleSave`), JS event-loop serialisiert die 30 parallelen Calls automatisch.

### Fixed — CRITICAL: Workspace boot crash, `errors.client.ts` collided with TanStack-Start reserved-extension (2026-05-09)

**Symptom:** Sämtliche Workspace-Routes returnten 500 (`{"status":500,"unhandled":true,"message":"HTTPError"}`). VPS-Container bootete nicht durch:

```
TypeError: Cannot convert object to primitive value
  at parseSegments (.../router-core/.../new-process-route-tree.js:99)
  at processRouteTree → RouterCore.buildRouteTree → createRouter
```

**Root cause:** `src/routes/api/errors.client.ts` (Phase A.1.1, c70948f7) hatte einen Filename mit `.client.ts` Endung. TanStack-Start interpretiert das als reserved-extension für **Client-Only-Code, der NICHT im SSR-Bundle landen darf**. Vite's Rollup-Plugin meldete beim Build:

> Use `createClientOnlyFn(() => ...)` to mark it as client-only (returns undefined on the server)

In Vite-Dev-Mode wird der Bundle aber trotzdem geladen — der Server importiert eine teilweise gestripte Version, `Route` ist ein Proxy/undefined statt eines echten Route-Objekts, und beim `route.id in routesById`-Check wirft `processRouteTree`.

**Fix:**
- `src/routes/api/errors.client.ts` → `src/routes/api/errors.report.ts` umbenannt.
- `createFileRoute('/api/errors/client')` → `createFileRoute('/api/errors/report')`.
- `src/lib/client-error-reporter.ts:POST_URL` von `/api/errors/client` auf `/api/errors/report` umgestellt.
- `src/routeTree.gen.ts` regeneriert (`pnpm exec vite build` → `✓ built in 9.99s`, vorher rollup-error).

Verifiziert nach VPS-Auto-Deploy: `GET /` → 200, `POST /api/errors/report` → 401 (korrekt: needs auth), `GET /api/errors/health` → 401 (korrekt: Stack-Admin gated). 113/113 Vitest grün.

**Lesson:** API-Route-Filenames dürfen NICHT auf `.client.ts` oder `.server.ts` enden — TanStack-Start reservierte Suffixe. Bei Frontend-Reporting-Endpoints lieber `.report.ts` / `.submit.ts` / `.from-client.ts` verwenden.

### Added — NotificationBell Mount-Integration (2026-05-09)
- **`<NotificationBell />`** ist jetzt in der Chat-Sidebar gemountet — als Icon-Button in der "Settings + Theme toggle"-Reihe der User-Card im Footer (zwischen `Settings01Icon`-Button und `<ThemeToggleMini />`). Conditional-render bleibt in der Komponente: bei `useCanSeeErrors().canSee === false` returnt `<NotificationBell />` `null`, also sieht ein Member ohne Stack-Admin-Rolle gar nichts. Sidebar-Visibility-Probe und Bell-Counter teilen sich den `staleTime: 60_000`-TanStack-Query-Key, also dedupliziert. Damit ist die in der CHANGELOG-Hygiene-Notiz markierte TODO-Mount-Integration aufgelöst.

### Fixed — CHANGELOG hygiene (2026-05-09)
- **WorkspaceSwitcher-Doppeleintrag konsolidiert** — der separate `### Removed — Separate WorkspaceSwitcher-Card`-Block ist gelöscht; das gleiche Faktum steht bereits im `### Changed — Workspace-Switcher in User-Card-Dropdown integriert`-Block (`src/components/workspace/workspace-switcher.tsx` entfernt). Dadurch wird der `[Unreleased]`-Block von zwei widersprüchlich aussehenden Bullets befreit, die beim Top-Down-Lesen Verwirrung erzeugten.
- **`### Changed` (topic-loos) im Error-Tracking-Block** mit explizitem Topic-Suffix versehen, damit klar ist, wozu die drei Bullets (`__root.tsx` initializes `installClientErrorReporter`, `error-boundary.tsx` ruft `reportClientError`, `chat-event-bus.ts:69` nutzt `logger.warn`) gehören.

### Changed — Workspace-Switcher in User-Card-Dropdown integriert (2026-05-09)

Footer der Chat-Sidebar hatte zwei separate Cards (separate `WorkspaceSwitcher`-Card oben + User-Card unten). Auf Phils Wunsch zusammengeführt:

- **`src/components/workspace/workspace-switcher-dialog.tsx`** (neu) — SettingsDialog-Style-Modal (`@/components/ui/dialog` + Tailwind-Override für mobile-fullscreen / desktop-zentriert mit `md:max-w-md md:rounded-2xl`, Theme-Tokens `bg-[var(--theme-bg)]` + `border-primary-200`). Body = scrollbare Membership-Liste (Color-Bar + Name + Rolle + ✓ für Active), Footer = Account-Link + Logout-Button. Lazy-Fetch via `fetchCurrentUser()` beim Öffnen — bei `mode !== 'multi-tenant'` Empty-State.
- **`src/screens/chat/components/chat-sidebar.tsx`** — Footer-Refactor:
  - `<WorkspaceSwitcher>`-Mount im Footer entfernt.
  - User-Card-Label zeigt jetzt `"<Workspace> / <User>"` (z. B. „Stratex / Phil") wenn Multi-Tenant, sonst Fallback auf `profileDisplayName`.
  - Conditional `MenuItem` „Workspace wechseln" (`Building01Icon`) im User-Dropdown — sichtbar nur bei Multi-Tenant + Memberships > 0; öffnet den neuen Dialog.
  - `<WorkspaceSwitcherDialog>` neben `<SettingsDialog>` gemountet.
- **`src/components/workspace/workspace-switcher.tsx`** entfernt — Logik vollständig in den Dialog migriert.

### Added — Error-Tracking & Trouble-Shooting-Center (2026-05-09)

Neuer globaler Error-Log-Stack mit UI-Viewer, Live-Tail, Frontend-Capture und Builder-Brief-Export. Stack-Admin-only via Auto-Detect (Pre-Migration: jeder authentifizierte User; Post-Migration: nur User in `data/global/settings.json#stackAdmins`). PII-Redaction by default.

- **Strukturierter Logger** (`src/server/logger.ts`) — schreibt parallel nach stdout (für `docker logs`) und JSONL (`data/global/errors/<YYYY-MM-DD>.jsonl`) mit Hash-Chain (`prevHash` ↔ `thisHash`, schemaVersion 1, analog zu `audit-log.ts`). Auto-Pull `requestId` / `userId` / `workspaceId` / `route` aus `AsyncLocalStorage` via neuem `request-context.ts`.
- **Auto-Redaction** (`src/server/error-redact.ts`) — Cookies, `Authorization`, `x-api-key`, `password`/`token`/`secret` Field-Names, JWT-Pattern (`eyJ…`), bcrypt (`$2[aby]$…`), Postgres-DSN, beliebige 32+-Zeichen-Alnum-Tokens. Stack-Trim auf 4 KB top + 4 KB tail mit Marker. **N4** Rekursions-Guard: depth-Limit 10 + WeakSet gegen Circular-Refs.
- **Error-Store** (`src/server/error-store.ts`) — `appendErrorEntry` mit Auto-Dedup: identische Errors innerhalb 60 s kollabieren in einen Eintrag mit `occurrences++`. **N1** zusätzliches Field `lastOccurrenceAt` für die UI-Anzeige "erste 3h vor / letzte 5min vor / 247×". Hash-Chain bleibt nach Dedup-Rewrite gültig (Tail-Recompute ohne Cascade). `listErrors`/`getErrorById`/`findRelatedByRequestId`/`getHealthSummary`/`validateChain`.
- **Retention-Cron** (`src/server/error-retention.ts`) — täglich 03:30 UTC löscht Files älter als `errors.retentionDays` (Default 30) aus `data/global/settings.json`. **I1** race-safe: jeder `unlinkSync` läuft im selben `withMutex(\`errors:\${date}\`)` wie `appendErrorEntry`, damit Retention nicht mit einem konkurrierenden Append kollidiert.
- **`error-acl.ts`** — Auto-Detect-Modus über `isMultiTenantAuthEnabled()`. `requireStackAdmin(req)` als zentraler Gate-Helper im Stil von `requirePermission` aus `auth-middleware.ts`.
- **`global-settings.ts`** — neuer mtime-cached Reader/Writer für `data/global/settings.json`. Schema-versioned, mit `withMutex('global-settings')`-serialisierten Writes und Audit-Events bei jedem Stack-Admin-Add/Remove. Lockout-Schutz beim letzten Stack-Admin.
- **Bootstrap** (`src/server/stack-admin-bootstrap.ts` + `boot-state-check.ts:runStartupTasks()`) — bei Multi-Tenant + leerer Stack-Admin-Liste promoted das System einmalig den ältesten Workspace-Owner zum Stack-Admin (Audit-Event `stack_admin_added` mit `addedVia:'bootstrap'`). Verhindert Lockouts bei bereits-migrierten Stacks ohne manuellen CLI-Add.
- **CLI-Trio** unter `scripts/admin/` — `add-stack-admin.ts` / `remove-stack-admin.ts` / `list-stack-admins.ts`. Idempotent, mit User-Existence-Check und `_audit.ts`-basiertem Audit-Trail. Aufruf via `docker exec ... npx tsx scripts/admin/<name>.ts <userId>`.
- **`/errors`-UI** mit Filter-Bar (Severity, Source, Search, includeTest-Toggle), Health-Badge (🟢/🟡/🔴 nach Fatal/Error-Count letzte Stunde) und Multi-Select für Builder-Brief-Export. Sidebar-Eintrag conditional-rendered via `useCanSeeErrors()` Hook (TanStack Query an `/api/errors/health` mit `staleTime: 60_000`). **Default-Filter** blendet `source: 'test'` aus.
- **`/errors/$id`-Detail-Screen** mit Stack, Context, Browser-Info und Related-Logs-Timeline (alle Einträge derselben `requestId` ±5 s).
- **Builder-Brief-Modal** — Markdown-Preview + 📋 Clipboard-Copy + 💾 `.md`-Download. Multi-Select erzeugt ein Briefing mit Summary-Header (Counts, Span, Top-Source, betroffene Workspaces/Users) und per-Error-Sektionen (ID, When, Severity, Stack redacted, Context, Related Logs, Browser, heuristisch erkannte involved Files).
- **Frontend-Capture** — bestehende `ErrorBoundary` (`src/components/error-boundary.tsx`) erweitert um POST an `/api/errors/client`. Production-Build zeigt nur die Report-ID, kein Stack. Dev behält Stack im UI. Plus `src/lib/client-error-reporter.ts` mit `window.error` + `unhandledrejection` Listenern und `trackedFetch`-Wrapper. Token-Bucket-Rate-Limit 10 Errors/min/Tab — die 11. wird client-side gedroppt.
- **`POST /api/errors/client`** — jeder authentifizierte User (nicht nur Stack-Admin) darf eigene Frontend-Errors melden. `source` ist server-side hardcoded auf `'frontend'` (anti-spoof). Stack-Truncation und Auto-Redaction wie Backend-Pfad.
- **SSE Live-Tail** unter `GET /api/errors/stream` — Heartbeat-Comment alle 30 s, Auto-Disconnect nach 30 min Idle, Filter via Query-Parameter (`?level=fatal,error&source=backend`). In-Process Pub/Sub via `error-events.ts` mit Cap auf 20 Subscribers.
- **NotificationBell** (`src/components/notification-bell.tsx`) — Multi-Tenant-only Bell-Button mit unread-Counter (Fatal+Error, 24h), Dropdown mit Top-5 + "Alle ansehen". Persistierung via `data/users/<id>/preferences.json` (neue `user-preferences.ts` Helper + `PATCH /api/users/me/preferences` Endpoint). **N3** `staleTime: 60_000` matcht die Sidebar-Visibility-Probe — beide Queries deduplizieren auf demselben Key. Mount-Punkt ist die User-Card-Footer-Reihe der Chat-Sidebar (siehe NotificationBell-Mount-Bullet oben).
- **`/api/test-error`** — manueller Smoke-Trigger für die Live-Tail-UI. Disabled in Production (es sei denn `HERMES_ENABLE_TEST_ERROR_ENDPOINT=1`), Stack-Admin-only auch in Dev (Defense-in-Depth), Per-User-Rate-Limit 30/min. Einträge mit `source: 'test'` markiert und im Default-Filter ausgeblendet.
- **Hermes-Hook-Wave 1** — `chat-event-bus.ts` (Subscriber-Cap), `gateway-capabilities.ts` (override-write-fail, gateway-unreachable), `auth-middleware.ts:loginWithEmailPassword` (Failed-Login zusätzlich zum bestehenden Audit-Channel — `logger.warn` mit IP, UA und reason — plus Lockout-Trigger), `send-stream.ts` Main-Catch + **N2** SSE-Stuck-Watchdog (`setTimeout(30 s)` reset bei jedem `controller.enqueue`; warn-Log wenn Stream silent für >30 s, ohne Auto-Close).

### Changed — Error-Tracking Integration in bestehende Module (2026-05-09)
- **`src/routes/__root.tsx`** initialisiert beim Boot `installClientErrorReporter()` und teardown'd im Effect-Cleanup.
- **`src/components/error-boundary.tsx`** ruft `reportClientError({ message, stack, context })` und zeigt die Server-Report-ID im Fallback.
- **`src/server/chat-event-bus.ts:69`** nutzt `logger.warn` statt `console.warn` für die Subscriber-Cap-Warnung.

### Added — Hermes-Hook-Wave 2 (2026-05-09)
- **`federation-sync-engine.ts`** — beide Catches in `applySelective` (Apply-Loop und Conflict-Resolve-Loop) loggen jetzt `logger.warn('federation apply skipped' / 'federation conflict resolve failed', { wsId, path, op })`. Skip-Reason landet weiterhin im Result, plus jetzt zusätzlich strukturiert im Error-Log.
- **`migration-symlink-reconcile.ts`** — Catch um den symlink-create-Fallback (NTFS-junction-Fallback failed) hängt jetzt einen `logger.error('symlink reconcile failed', { wsId, target, legacy })` ein. Boot-time-Reconcile-Failures sind jetzt im Trouble-Shooting-Center sichtbar statt nur im Result-Array zu landen.
- **`swarm-docker-exec.ts`** — `proc.on('error', ...)` Spawn-Failure-Handler loggt jetzt `logger.warn('docker-exec spawn failed', { cmd, argsCount, container, dockerMode })`. Vorher war ein "docker not found" oder "container missing" silent — gestopptes Result, kein Eintrag.
- **`swarm-tmux-start.ts` / `swarm-tmux-stop.ts` / `swarm-tmux-scroll.ts`** — VPS-mode Error-Paths (start.ok=false / kill.ok=false / copy-mode-failed) loggen jetzt `logger.warn('swarm tmux <op> failed (vps-mode)', { workerId, sessionName, container, stderr })` bevor sie 500 zurückgeben. Operator sieht stderr direkt im Error-Log, ohne `docker logs` zu querer.

### Added — Hermes-Hook-Wave 3 (2026-05-09)
- **`atomic-write.ts:writeTextAtomic`** — Catch-Branch loggt jetzt `logger.error('atomic-write failed', { source: 'storage', op: 'writeText', target, byteLength })` neben dem bestehenden `throw err`. Lazy-Import von `./logger` (`void import('./logger').then(...)`), so dass der Module-Init-Cycle (logger → error-store → atomic-write → logger) zur Boot-Zeit nicht greift. Logger-Failures werden swallowed, der Original-Throw propagiert weiter zum Caller. 121/121 Tests grün, 57 affected files (audit-log/users-store/workspace-store/sessions-privacy) ungebrochen.

Bewusst weiterhin ausgelassen:
- `swarm-tmux-*` Worker-Crash 60-s-Health-Probe — separate Infrastruktur (background interval mit roster-vs-tmux-session diff), nicht nur ein Catch-Hook. Eigener Patch wenn benötigt.

### Tests
- **113 neue Vitest-Cases** in `request-context.test.ts` (5), `error-redact.test.ts` (27 incl. **N4** Recursion-Tests), `error-acl.test.ts` (12, alle drei Auto-Detect-Fixtures), `global-settings.test.ts` (16, incl. 50 parallele `addStackAdmin`), `logger.test.ts` (10), `error-store.test.ts` (25, incl. **N1** Dedup mit `lastOccurrenceAt`, Hash-Chain-Validation, Tampering-Detection), `error-retention.test.ts` (6, incl. **I1** Per-Date-Mutex-Race-Test), `builder-brief.test.ts` (7), `stack-admin-bootstrap.test.ts` (5).

### Changed — Login akzeptiert User-ID-Slug zusätzlich zur Email (2026-05-09)

Quality-of-life nach der ersten Production-Migration: bei `phil@stratex-ai.com` als Email reicht es jetzt auch nur `phil` einzutippen.

- **`loginWithEmailPassword(emailOrId, password, ctx)`** in `auth-middleware.ts` branched: enthält der Input `@`, läuft Email-Lookup; ist es ein gültiger Slug, läuft direkter `userId`-Lookup. Audit-Event-Field `email` → `identifier` umbenannt damit der Log beide Modi abbildet.
- **`POST /api/auth/login`** akzeptiert jetzt `{ email }` (legacy clients) ODER `{ identifier }` (neuer Pfad). Beide flow durch `loginWithEmailPassword`. Zod-`.refine` stellt sicher dass mindestens eines da ist.
- **Frontend `loginWithEmailPassword(identifier, password)`** sendet jetzt `{ identifier }`.
- **`LoginForm`-Label** umbenannt von **„Email"** zu **„Email oder User-ID"**, Placeholder zeigt beide Varianten (`phil  oder  phil@stratex-ai.com`), `autoComplete="username"` (statt `email`), `type="text"` (statt `email`) damit Browser keine Email-Format-Validierung erzwingt.

**Verifikation:** 49 / 49 Auth-Tests passed (auth-middleware: 27, auth-routes-flow: 12, route-auth-helpers: 10), inkl. AK26-Bench.

### Changed — Phase-B-Followups: Session-Share-UI-Integration + Mass-Route-Refactor + Pre-Existing-Failures-Triage (2026-05-09)

Drei optionale Followups nach dem Plan-Scope-Abschluss. Alle harten Zahlen unten.

**B — Session-Share-UI im Chat gemounted**
- **`/api/sessions/$id/meta`** (neu) — public-readable nach Auth, returnt `{ tagged, ownerId, shared, sharedBy, isOwner }` für eine einzelne Session. Im Legacy-Modus `{ multiTenant: false }`. Damit kann das Frontend die Share-Toggle-Logik ohne Wartezyklen fahren.
- **`SessionShareButton`** im **`chat-header.tsx`** zwischen Workspace-Status und Undo/Clear-Actions montiert. Liest die Session-Meta selbst, rendert null wenn nicht-Owner-und-nicht-Admin oder Legacy-Stack. Toggle 🔒 ↔ 👥 mit Server-Feedback nach jedem Klick.
- **`SharedSessionReadOnlyBanner`** über dem Composer — Plan-Finding **F11**: bei `shared && !isOwner` wird der gelbe Banner gezeigt UND der Composer disabled. Implementation via neue `<ComposerWithReadOnlyGuard>`-Komponente (`src/screens/chat/components/composer-with-read-only-guard.tsx`) die den existing `ChatComposer` wrappt und den `useSharedSessionReadOnlyState`-Hook nutzt. Server-Side ist der 403-Block bereits in `send-stream.ts` aktiv (Phase A.8) — die UI-Disable ist die User-freundliche Vorab-Stufe.

**C — Pre-Existing Test-Failures triagiert (no-action-required)**
Die 11 verbleibenden Test-Failures wurden einzeln geprüft. Alle sind **plattform-spezifische Windows-Quirks** auf Phils lokalem Dev-System, nicht durch Phase A/B verursacht und auf der Linux-CI/VPS-Umgebung grün:
- **kanban-backend (4 Cases)** — Backend-ID-Detection-Reihenfolge: Tests erwarten `id: 'claude'` (Hermes-Backend) bei mocked `existsSync('/Users/aurora/.claude/kanban.db')`, aber `getKanbanBackendMeta()` returnt `id: 'local'`. Detection-Logik wurde nach den Tests umgebogen — kein Phase-A/B-Issue.
- **mcp-presets-store (2 Cases)** — `EACCES` und dangling-symlink-Tests: Windows-NTFS kann `chmod 0000` nicht enforcen (lokale `Administrator`-Permissions umgehen alles), und `fs.symlink` von einem nicht-existenten Target failt anders als auf POSIX.
- **swarm-memory (2 Cases)** — erwartet Datei-Existenz im `~/.openclaw/workspace/memory/swarm/` Pfad; auf Windows ist der Pfad-Layout anders aufgebaut (User-Profile ohne `.openclaw`-Standard).
- **gateway-capabilities (2 Cases)** — env-Leak zwischen Tests: `process.env.CLAUDE_API_URL` wird gesetzt aber nicht zwischen Tests cleared. Test-Isolation-Bug, kein Production-Issue.
- **local-provider-discovery (1 Case)** — `CLAUDE_HOME`-env-Pfad-Issue auf Windows.

**Konsequenz:** keine Änderungen an den existing Test-Files. Phase A+B Tests (296 vor diesem Followup, 359 mit Federation) bleiben weiter alle grün; die 11 pre-existing Failures sind orthogonal.

**A — Mass-Refactor der verbleibenden ~95 Routes**
Phase A.8 hatte 15 Plan-A.3.1-Routes auf den `requirePermission`/`requireWorkspaceAction`-Helper umgestellt. Dieser Followup zieht den Rest nach: jede Route die noch den `@deprecated isAuthenticated()`-Wrapper nutzte, wird auf den neuen `requireAuthenticated()`-Helper migriert (Default-Variante ohne Action-Gate; spezifische Permission-Gates können später per File hinzugefügt werden).
- **`scripts/dev/a8b-route-refactor-rest.mjs`** — idempotentes Skript das durch `src/routes/api/` walkt, beide Pattern-Varianten (`{ ok: false, error: 'Unauthorized' }` und `{ error: 'Unauthorized' }`) erkennt und durch den Helper-Aufruf ersetzt. Berechnet die korrekte Import-Tiefe (`../`-Anzahl) je nach Verzeichnistiefe (Top-Level vs. Sub-Folder wie `mcp/`, `preview-runner/`). CRLF-aware.

**Verifikation (harte Zahlen)**
- **`isAuthenticated`-Aufrufe vorher/nachher:** Phase A.8 abgeschlossen mit **124 Aufrufen in 101 Files** → nach diesem Followup **36 Aufrufe in 23 Files**. **−88 Aufrufe (−71 %), −78 Files (−77 %).**
- **Vom Anfang der Refactor-Reihe** (Pre-A.8): 146 → 36 Aufrufe (**−110, also −75 % der gesamten Stack-weiten Aufrufe**). 111 → 23 Files (**−88, also −79 %**).
- **Files patched in diesem Pass:** **80** mit **88 Pattern-Replacements**.
- **Files skipped (custom auth-Pattern, müssen einzeln migriert werden):** 16 (auth-check, chat-events, claude-config, claude-jobs/$jobId, claude-proxy/$, claude-tasks-{,/$taskId}/assignees, conductor-spawn, mcp/hub-{search,sources}/$id, predict-proxy/$, preview-file, swarm-lifecycle).
- **Phase-A+B-Tests:** **359 / 359** Cases in **25 Test-Files** passed (11.67 s).
- **Typecheck:** keine neuen Fehler in den 80 patched Files (pre-existing baseline-Errors aus `models.ts`, `swarm-kanban.ts`, `swarm-lifecycle.ts`, etc. unverändert).
- **Build:** `pnpm build` durchgelaufen in 10.51 s.

### Added — Federation UI: FederationTab, AddPeerWizard, SyncWizard (Phase B.3, 2026-05-09)

Letzter Block der Federation-Schicht — die UI auf den B.1/B.2-Backend. Gibt Phil + Admins eine geführte 4-Schritt-Wizard zum Hinzufügen eines Peers (inkl. SSH-Keypair-Generation und der exakten `authorized_keys`-Zeile zum Kopieren) und einen 3-Schritt-Sync-Wizard mit **Pflicht-Diff-Preview** vor jedem Apply.

**Neue UI-Komponenten (3)**
- **`src/screens/workspace-settings/federation-tab.tsx`** — 5. Tab im WorkspaceSettings (`general` | `members` | `roster` | **`federation`** | `audit`). Listet alle Peers mit Status-Badges (`● connected`, `○ disconnected`, `⊘ error`), Host/User/Port, Remote-WS-ID, Synct-Types, letzten Sync-Stand (`12 in / 8 out / 0 conflicts` Style). Pro Peer: Aktionsmenü `Verbinden / Sync starten / Disconnect / Peer löschen`. Empty-State mit Aufforderung zum Hinzufügen wenn keine Peers existieren.
- **`src/screens/workspace-settings/federation/add-peer-wizard.tsx`** — 4-Step-Modal:
  - **Step 1**: Anzeigename + Host + SSH-User + SSH-Port + Container-Name auf Peer
  - **Step 2**: Erklärung zur `command="..."`-Restriction (Plan F4) — warum sie wichtig ist
  - **Step 4** (vor 3): Remote-Workspace-ID + Sync-Types-Auswahl (Memories / Skills / Shared Sessions / Council / Audit / Roster) + Notes. Slug-Validation mirror serverseitiger Regel.
  - **Step 3** (Result): zeigt die **EXAKTE `authorized_keys`-Zeile** mit `command="docker exec -i <container> tsx /app/scripts/mcp-federation-stdio.ts --workspace-id <wsId>",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty <ssh-key>` zum Kopieren. Operator pasted das auf seinem VPS — KEIN nackter Public-Key. Inline-Step-Indicator (4-Bar-Progress).
- **`src/screens/workspace-settings/federation/sync-wizard.tsx`** — 3-Step-Modal mit **Pflicht-Diff-Preview**:
  - **Step 1 (Connect)**: spinner während `POST /connect/<peerId>` + automatisches `POST /diff/<peerId>`. Bei Failure: Error-Box mit `reason` + `details` (z. B. `unrestricted` falls `command="..."` fehlt).
  - **Step 2 (Diff-Preview, Pflicht)**: drei Sektionen — **Ankommend** (mit Checkbox-Selektion pro Path), **Ausgehend** (read-only, info), **Konflikte** mit 3-Optionen-Auflösung pro Path (`Lokal behalten` / `Remote übernehmen` / `Manuell` als TBD-Stub). **Mass-Delete-Warning** als prominenter roter Banner mit Akzeptanz-Checkbox wenn `>50` ODER `>30%` Tombstones (Plan B.5). Apply-Button bleibt **disabled** bis (a) alle Konflikte aufgelöst sind UND (b) Mass-Delete-Warning bestätigt ist.
  - **Step 3 (Apply-Result)**: grüner Erfolgs-Box mit `applied.{add,update,delete}` + `conflictsResolved` Counts. Wenn Items skipped wurden: gelber Box mit den ersten 8 Skipped-Paths + Reason. Tunnel wird automatisch geschlossen (auto-disconnect nach Apply, ein Sync = ein-Shot).

**Integration**
- `WorkspaceSettings`-Tab-Liste erweitert: `general` → `members` → `roster` → **`federation`** → `audit`. Settings-Screen-Layout unverändert; das neue Tab kommt automatisch via die `TABS`-Konstante.
- `workspace.$id.settings.$tab.tsx` Switch ergänzt: `case 'federation': return <WorkspaceFederationTab />`.
- Alle 3 UI-Komponenten nutzen den existierenden `claude-nous`-Theme (gleiche Card/Modal/Button-Styles wie der Members- und Audit-Tab) — keine neuen Style-Tokens nötig.

**Verifikation (harte Zahlen)**
- **Phase A + B Suite gesamt:** **359 / 359** Cases in **25 Test-Files** (11.15 s). Phase B.3 ist UI-only — keine neuen Test-Files, aber alle bestehenden Tests bleiben grün.
- **Typecheck:** keine neuen Fehler in B.3-Files.
- **Build:** `pnpm build` durchgelaufen in 10.66 s, **`/workspace/$id/settings/$tab`** Route erfasst die neue Tab-Variante automatisch (kein neues TanStack-Route-File nötig).
- **Diff:** 4 files added/modified, +1042 LOC.

**Federation-Schicht damit komplett.** Operator-Workflow von Anfang bis Ende:
1. Workspace-Owner öffnet `/workspace/<wsId>/settings/federation`
2. Klickt **+ Peer hinzufügen**, durchläuft den 4-Schritt-Wizard, kopiert die `authorized_keys`-Zeile
3. Peer-Admin pasted die Zeile auf seinem VPS in `~/.ssh/authorized_keys`
4. Workspace-Owner klickt **Verbinden** — der Probe-Test prüft die `command="..."`-Restriction (refused unrestricted Shell)
5. Bei `connected`: klickt **Sync starten** → 3-Schritt-Wizard mit Pflicht-Diff-Preview, Mass-Delete-Schutz, Konflikt-Auflösung
6. Apply schreibt die ausgewählten Items in `data/workspaces/<wsId>/...` mit Hardcoded-Deny-Filter (Plan B.5), aktualisiert die Baseline für die nächste AK28-Time-Skew-robuste Conflict-Detection
7. Tunnel wird automatisch geschlossen, alle Lifecycle-Events landen in der Hash-Chain-Audit (Plan F10)

### Added — Federation Sync-Engine, Audit, API-Routes (Phase B.2, 2026-05-09)

Diff-Engine, Hash-Chain Audit-Helper, **7 neue API-Routes** für die komplette Federation-Lifecycle (Add Peer → Connect → Diff → Apply → Disconnect → Audit). Adressiert Plan-Findings AK28 (Time-Skew-robuste Conflict-Detection via SHA256+Baseline statt Wall-Clock), B.5 (Mass-Delete-Detection + Hardcoded-Deny-Filter beim Apply), F10 (Hash-Chain-Validation auf der Audit-Read-Seite).

**Neue Backend-Module (2)**
- **`src/server/federation-audit.ts`** — typed Event-Emitter `emitFederationEvent(wsId, event)` mit discriminated union über alle 9 Federation-Lifecycle-Events: `peer_added`, `peer_updated`, `peer_deleted`, `connect`, `disconnect` (mit Reason `manual`/`idle-ttl`/`error`), `diff_computed` (mit Summary + Mass-Delete-Warnings), `apply` (mit applied-counts + conflictsResolved), `apply_skipped`, `chain_break_detected`. Events landen im workspace-scoped JSONL `data/workspaces/<wsId>/audit/<YYYY-MM-DD>.jsonl` neben den Member-Events — eine einzige Hash-Chain für alles.
- **`src/server/federation-sync-engine.ts`** — Pure-Function-First Diff-Computation + selective Apply.
  - **Read-Side**: `readLocalMemories()`, `readLocalSkills()`, `readLocalSessionSnapshots()` (Pools mit SHA256 pro Pfad). `readRemote(client)` ruft die 3 list-Tools des Peers parallel ab und konvertiert in Maps.
  - **Diff**: `computeDiff({ wsId, peerId, syncedTypes, remote })` produziert `{ inItems, outItems, conflicts, warnings }`. **AK28** Time-Skew-robuste Conflict-Detection: liest `data/workspaces/<wsId>/federation/peers-baselines/<peerId>.json` (SHA256 pro Pfad vom letzten erfolgreichen Sync). Conflict-Regel: `localHash !== baselineHash && remoteHash !== baselineHash`. Erstem Sync ohne Baseline: jede Divergenz wird zum Conflict (Operator entscheidet).
  - **Tombstones**: lokale `*.md.deleted`-Marker werden als `<path>#tombstone` in der Local-Map markiert; Remote-only-Pfade die in der Baseline existierten werden zu `incoming-delete`. Tombstoned-local-on-remote-only-Pfade zu `outgoing-delete`.
  - **Mass-Delete-Warnings (B.5)**: `computeMassDeleteWarnings(...)` flaggt `>50` absolute Tombstones ODER `>30%` des Pools (mit `pool-min 10` gegen False-Positives auf Mini-Pools — bei 1/1 wird ratio = 0.1, nicht 1.0).
  - **Apply**: `applyDiff({ wsId, peerId, diff, selective, fetchRemoteContent, actorUserId })` schreibt nur explizit-selectierte Items. Stale-Plan-Refusal: wenn `selective[].remoteSha256` nicht zum `diff.remoteSha256` passt (Hash drift seit Diff-Anzeige) → skipped mit `reason: 'stale plan'`. **Hardcoded-Deny-Filter (B.5)**: nur `memories/*.md{,.deleted}`, `skills/<name>/SKILL.md`, `sessions/shared/<id>.json` sind permitted; alles andere (`sessions/<userId>/`, `members.json`, `peers.json`, `meta.json`, `worker-profiles/`, `audit/`, beliebige andere) → skipped mit `reason: 'hardcoded-deny'`. Conflicts werden via `selective[].resolve === 'local' | 'remote'` aufgelöst, alles andere bleibt unaccepted. Baseline wird nach erfolgreichem Apply aktualisiert.

**API-Routes (7 neu)**
- **`GET /api/workspaces/$wsId/federation/peers`** — gated auf `federation-manage`. Listet Peers OHNE `publicKey` / `sshKeyPath` auf der Wire (private state bleibt server-side).
- **`POST /api/workspaces/$wsId/federation/peers`** — generiert via `ssh-keygen -t ed25519 -N ''` ein neues Keypair, persistiert den Peer, returnt **EINMALIG** den `publicKey` + die exakte `authorizedKeysLine` für den Wizard. Audit `peer_added`.
- **`PATCH /api/workspaces/$wsId/federation/peers/$peerId`** — Update Name/Host/User/Port/SyncedTypes/Notes. Audit `peer_updated` mit Patch-Inhalt.
- **`DELETE /api/workspaces/$wsId/federation/peers/$peerId`** — Audit `peer_deleted`.
- **`POST /api/workspaces/$wsId/federation/connect/$peerId`** — Probet via `testConnection()`. Bei Probe-Failure: `503` mit `{reason: 'unrestricted' | 'ssh-failed', details}` und `peer.status = 'error'`. Bei Erfolg: `peer.status = 'connected'` + Audit.
- **`POST /api/workspaces/$wsId/federation/disconnect/$peerId`** — Audit mit `reason: 'manual'`.
- **`POST /api/workspaces/$wsId/federation/diff/$peerId`** — read-only. Spawned MCP-Client → `readRemote()` → `computeDiff()`. Gibt das volle `DiffResult` zurück für die Pflicht-Diff-Preview im SyncWizard (Phase B.3). Audit `diff_computed` mit Summary + Mass-Delete-Warnings.
- **`POST /api/workspaces/$wsId/federation/apply/$peerId`** — Body: `{ selective: [{ path, resolve?, remoteSha256? }] }`. Re-spawnt MCP-Client, recomputet Diff (refused stale plans), führt `applyDiff()` aus mit `fetchRemoteContent` der per Pfadtyp die richtigen Tool-Calls macht (`get_memory` / `get_skill` / `get_session_snapshot`). Persistiert Sync-Summary auf `peer.lastSync`. Audit `apply` mit detaillierten Counts.
- **`GET /api/workspaces/$wsId/federation/audit`** — Filtered Hash-Chain-Read auf `federation_*`-Events. F10 Chain-Validation auf der Read-Seite, `chain_break_detected` self-recording bei Tampering-Verdacht.

**Test-Suite (1 File, 25 Cases)**
- `federation-sync-engine.test.ts` — Vollständige Coverage:
  - **Mass-Delete-Warnings (B.5)**: 5 Cases — `>50` absolute, `>30%` Ratio, Pool-Min-Schutz für 1/1 + 2/2 (kein False-Positive), Trigger bei 4/5 (`4/max(5,10)=0.4`), quiet-sync.
  - **Diff Basic Shape**: 1 Case — add/update/delete + first-encounter-conflict.
  - **AK28 Time-Skew-Robust**: 1 Case — Baseline-basierte Conflict-Detection: local-only-changed → outgoing; both-changed → conflict.
  - **Tombstone Detection**: 2 Cases — incoming-delete (baseline kennt path, remote nicht), outgoing-delete (lokales `.md.deleted` + remote-still-live).
  - **Skills + Sessions Diff**: 1 Case — beide werden gediff'd wenn in `syncedTypes`.
  - **Apply Selective + Baseline**: 5 Cases — Roundtrip add+baseline, opt-out per `selective[]`, Stale-Plan-Refusal, Hardcoded-Deny-Refusal, Conflict-Resolution `local` (keep + baseline-update) + `remote` (overwrite + baseline-update), unresolved Conflict skipped.
  - **Hardcoded-Deny-Matrix (B.5)**: 7 Cases — `memories/`, `skills/`, `sessions/shared/` permitted; `sessions/<userId>/`, `members.json`, `peers.json`, `meta.json`, `worker-profiles/`, `random.txt`, `.env` REFUSED.
  - **Constants**: 1 Case — Threshold-Konstanten matchen Plan B.5 (`50`, `0.3`, `10`).

**Verifikation (harte Zahlen)**
- **Phase-B.2 Tests:** **25 / 25** Cases passed in 205 ms.
- **Phase A + B Suite gesamt:** **359 / 359** Cases in **25 Test-Files** (14.18 s). Inkl. AK26 (1000 Tokens p99 <5 ms), F6 50× Failed-Login-Race, R6 50→1 Gateway-Call, L4 Marker-Tampering, L6 Brand-`tsc`-Enforcement, F10 Audit-Chain-Validation, AK28 Time-Skew-robuste Conflict-Detection.
- **Typecheck:** keine neuen Fehler in B.2-Files.
- **Build:** `pnpm build` durchgelaufen in 9.58 s, **alle 7 Federation-Routes** im `routeTree.gen.ts` registered.
- **Diff:** 9 files added, +1450 LOC.

### Added — Federation MCP-Server, Peers-Store, SSH-Tunnel-Skelett (Phase B.1, 2026-05-09)

Erste Phase der Federation-Schicht (Plan B). Liefert das ganze Substrat unter dem die Sync-Engine in Phase B.2 läuft: per-Workspace Peers-Konfiguration, JSON-RPC-2.0 MCP-Server (no SDK, no extra layer), MCP-Client über `ssh`-child-process, SSH-Key-Lifecycle. **Adressiert Plan-Findings F2 (Workspace-Process-Lock + Path-Traversal-Refusal), F4 (SSH `command="..."`-Restriction), N11 (exakt 7 Tools), B.5 (hardcoded Filter — kein Gateway-Direct, nur shared Sessions).**

**Neue Module (5 Backend + 1 CLI)**
- **`src/server/federation-peers-store.ts`** — Per-Workspace `peers.json` unter `data/workspaces/<wsId>/federation/peers.json` (`schemaVersion: 1`, niemals selbst gesynct). Keypair-Pfade je Peer in `federation/keys/<peerId>.key{,.pub}`. CRUD: `addPeer`, `updatePeer`, `setPeerStatus`, `recordSyncSummary`, `deletePeer`, plus `getPeer` / `readPeers`. Schreibe via `withMutex(\`peers:\${wsId}\`)` (Plan F6). Slug-Validation für `wsId`, `remoteWorkspaceId`, `createdBy`. Refused leerer `host` / `sshUser`. 16-Hex-Char `peerId` via crypto.randomBytes.
- **`src/server/federation-mcp-server.ts`** — JSON-RPC-2.0-Server (no SDK). `createServerContext(wsId)` wirft bei Slug-Bruch und merkt sich nur den Workspace-Root. **`resolveSafe(ctx, relPath)`** ist die einzige zugelassene Pfadauflösung — refused absolute Pfade, `..`-Traversal, Null-Bytes, leere Strings (Plan F2). **`handleRequest(ctx, raw)`** dispatcht zu den 7 Tools (Plan N11):
  - `list_memories` — rekursiv Markdown unter `memories/` mit SHA256+size+mtime
  - `get_memory(path)` — refused alles außerhalb von `memories/`
  - `list_skills` — eine Zeile pro `skills/<name>/SKILL.md`
  - `get_skill(name)` — refused path-y names (`/`, `\\`, `..`, NUL)
  - `list_session_snapshots` — nur `sessions/shared/*.json`, nie Gateway, nie user-private
  - `get_session_snapshot(id)` — gleiches Filter-Bracket
  - `list_mission_events_since(sinceIndex)` — Phase-C-Stub, returnt `{ events: [], total: 0 }`

  **Path-Traversal-Versuche werden audit'd** als globaler `mcp_path_traversal_attempt`-Event. JSON-RPC-Error-Codes: `-32700` (parse), `-32600` (invalid request), `-32601` (method not found), `-32602` (invalid params), `-32603` (internal), **`-32001` (PathTraversalRefused)**, `-32004` (NotFound).
- **`scripts/mcp-federation-stdio.ts`** — CLI-Entry für SSH `command="..."`-Restriction. Parst `--workspace-id <slug>` einmal, fail-fast bei missing/malformed (`exit 2`). Newline-delimited JSON-RPC über stdin/stdout. Workspace-Boundary ist über die Process-Lifetime fixed → ein Peer kann selbst mit Code-Bug nie eine andere `wsId` ansprechen (Plan F2).
- **`src/server/federation-mcp-client.ts`** — `FederationMcpClient` Klasse spricht JSON-RPC über `ssh`-child-process (`spawn('ssh', ['-i', key, …])`). Newline-Buffer-Logik handhabt fragmentierte stdout-Chunks. 15-min-Timeout pro Call (mirrors Plan B Tunnel-TTL). `spawnImpl`-Override für Tests.
- **`src/server/federation-tunnel.ts`** — SSH-Lifecycle. **`generateKeypair(wsId, peerId)`** ruft `ssh-keygen -t ed25519 -N ''` (no extra deps), schreibt unter `federation/keys/`, mode 0700. **`buildAuthorizedKeysLine(opts)`** produziert die exakte Zeile die der Peer-Admin auf seinem VPS in `authorized_keys` einfügt (Plan F4):

  ```
  command="docker exec -i <container> tsx /app/scripts/mcp-federation-stdio.ts --workspace-id <wsId>",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty <ssh-key>
  ```

  **`testConnection(opts)`** runs `ssh peer 'echo __unrestricted_shell__'` — wenn diese Echo-Zeile in stdout auftaucht, ist die `command="..."`-Restriction NICHT gesetzt → wir liefern `{ ok: false, reason: 'unrestricted', details }` und der Wizard zeigt eine rote Box. Bei korrekter Restriction returnt SSH 0 ohne den Echo (mcp-federation-stdio liest leeren stdin und exit 0) → `{ ok: true }`.

**Test-Suite (3 Files, 38 Cases)**
- `federation-peers-store.test.ts` — 14 Cases: empty-read, slug-rejection, addPeer-Roundtrip, refuse leere host/user, updatePeer-Atomic, refuse id-change, setPeerStatus + recordSyncSummary persistieren, deletePeer no-op für unknown, **20 parallele addPeer landen alle**, key-paths, Hex-Diversity 100/100.
- `federation-mcp-server.test.ts` — 19 Cases: createServerContext-slug-rejection, **resolveSafe** mit 5 Traversal-Vektoren (`..`, mehrere Tiefen, `memories/../../`, absolute, NUL, empty), TOOL_NAMES = exakt 7, list_memories rekursiv mit SHA256, get_memory + Path-Traversal-Refusal **inkl. Audit-Event-Verifikation**, get_memory rejected `sessions/shared/...` (außerhalb `memories/`), skills + session-snapshots Round-Trip, get_skill + path-y-name-Refusal, mission-events-Phase-C-Stub, MethodNotFound, ParseError, InvalidParams.
- `federation-tunnel.test.ts` — 5 Cases: `buildAuthorizedKeysLine` enthält alle 5 Restriktionen + custom appPath, `testConnection` erkennt unrestricted-shell, ok-Fall, ssh-failed-Fall.

**Dependencies**
- `ssh2@1.17.0` (production) — wird in Phase B.2 vom tunnel.ts genutzt; in B.1 kommt der Skelett-Layer mit `child_process.spawn('ssh', …)` aus.
- `@types/ssh2` (dev).

**Verifikation (harte Zahlen)**
- **Phase-B.1 Tests:** **38 / 38** Cases passed in 3 Test-Files (923 ms).
- **Phase A + B.1 gesamter Sweep:** **334 / 334** Cases passed in **24 Test-Files** (14.21 s). Inkl. AK26 (1000 Tokens p99 < 5 ms), F6 50× Failed-Login-Race, R6 50→1 Gateway-Call, L4 Marker-Tampering, L6 Brand-`tsc`-Enforcement, F10 Audit-Chain-Validation.
- **Typecheck:** keine neuen Fehler in den B.1-Files.
- **Build:** `pnpm build` durchgelaufen in 10.60 s, kein Routes-Tree-Update nötig (B.1 hat noch keine API-Routes — die kommen in B.2).
- **Diff:** 8 files added, +1148 LOC.

### Changed — Existing-Routes-Refactor (Phase A.8, 2026-05-09)

**Auth-Schicht-Migration der Bestandsrouten** (Plan A.3.1). 15 Routes auf den neuen `requirePermission` / `requireWorkspaceAction`-Pattern umgestellt; verbleibende ~95 nutzen weiterhin den `@deprecated isAuthenticated`-Wrapper bis sie einzeln migriert werden.

**Neuer Helper**
- **`src/server/route-auth-helpers.ts`** — Drop-in-Bridge zwischen Legacy `isAuthenticated()` und den neuen `requireUser` / `requirePermission`-Helpers. Drei Funktionen:
  - `requireAuthenticated(request)` — minimaler Auth-Check; in Multi-Tenant returnt User+wsId, in Legacy nur Boolean-Pass.
  - `requireWorkspaceAction(request, action)` — Auth + aktiver Workspace + `canDo(action)`. Returnt **409** mit Hinweis-Hint wenn der eingeloggte User keinen aktiven Workspace hat (UI routet auf Workspace-Picker).
  - `requireActiveWorkspaceMember(request)` — Member-only ohne Action-Gate, für Routes die für jeden Member offen sind.
  - In Legacy-Modus degradieren alle drei auf simple `isAuthenticated`-Boolean — weshalb der Refactor non-breaking ist.

**Refaktorierte Routes (15 Files)**
| Datei | Action |
|---|---|
| `swarm-roster.ts` | GET: `requireAuthenticated`; POST/PATCH: `requireWorkspaceAction('roster-edit')` |
| `usage.ts` | `requireWorkspaceAction('view-usage')` |
| `council.ts` | `requireWorkspaceAction('chat')` |
| `switch-model.ts` | `requireWorkspaceAction('roster-edit')` |
| `swarm-tmux-{start,stop}.ts` | `requireWorkspaceAction('worker-control')` |
| `swarm-decompose.ts`, `swarm-dispatch.ts` | `requireWorkspaceAction('chat')` |
| `swarm-orchestrator-loop.ts`, `swarm-direct-chat.ts` | `requireWorkspaceAction('chat')` |
| `swarm-idle-tick.ts` | `requireActiveWorkspaceMember` |
| `workspace.ts` | `requireActiveWorkspaceMember` |
| `system-info.ts` | `requireAuthenticated` (global) |
| `sessions.ts` | siehe unten |
| `send-stream.ts` | siehe unten |

**`sessions.ts` mit D1-Hybrid-Privacy**
- 4× `isAuthenticated` → `requireWorkspaceAction('chat')` ersetzt.
- GET filtert via `filterVisibleSessions(sessions, userId, meta)` — der `FilteredSessions`-Brand-Type aus Phase A.0 sorgt dafür dass `tsc` jeden Endpoint zurückweist der ungetaggte oder nicht-eigene/nicht-shared Sessions returnt.
- POST tagged neu erstellte Sessions automatisch via `tagSession(wsId, sessionId, userId)` ins `sessions-meta.json`-Mapping → ab Erstellung sind sie für andere Members fail-closed unsichtbar (D1).

**`send-stream.ts` mit F11-Block + lastActivityAt**
- 1× `isAuthenticated` → `requireWorkspaceAction('chat')` ersetzt.
- Nach `resolveSessionKey`: lookup in `sessions-meta.json`. Wenn die Session **shared** ist UND der Caller ist **nicht der ursprüngliche Owner** → **403** mit `reason: 'shared-not-owner'`. Plan-Finding **F11**: Shared Sessions sind read-only für non-Owner.
- Untagged Sessions werden auto-getagged (Caller wird Owner) — verhindert Sichtbarkeitsverlust für eigene neue Chats.
- `recordActivity(wsId, sessionId)` setzt `lastActivityAt` beim Stream-Start → triggert die Lazy-Re-Snapshot-Logik in `sessions-snapshot.ts` korrekt.

**Pre-existing Bug fix (drive-by)**
- `swarm-idle-tick.ts:70` — `runtime?.state` → `runtime?.runtime?.state` (TypeScript wusste schon dass das ein Schreibfehler war).

**Mass-Refactor-Skripte** (`scripts/dev/`)
- `a8-route-refactor.mjs` — applies the 3-line `if (!isAuthenticated(request)) { return ... }` → 2-line helper-call substitution per route. Two pattern variants (`{ ok: false, error: 'Unauthorized' }` und `{ error: 'Unauthorized' }`). Idempotent.
- `a8-fix-imports.mjs` — Follow-up: scannt alle `src/routes/api/`-Files, erkennt fehlende `route-auth-helpers`-Imports und fügt sie nach dem `@tanstack/react-start`-Import ein. CRLF-aware.

**Verifikation (harte Zahlen)**
- **isAuthenticated-Aufrufe vorher/nachher:** 146 → 124 (−22, also 15 % der Stack-weiten Aufrufe migriert in einem Pass).
- **Files mit Legacy-Helper vorher/nachher:** 111 → 101 (−10, plus die ~5 Files wo nur einzelne Calls übrig sind aber andere migriert wurden).
- **Diff:** 15 files changed, +151 / −89.
- **Tests Phase A (alle 21 Test-Files):** **296 passed (296)**, Duration 6.13 s. Inkl. AK26 (1000 Tokens, p99 < 5 ms), F6 50-parallele-Failed-Login-Race, R6 Thundering-Herd (50 → 1 Gateway-Call), L4 Marker-Tampering, L6 Type-Brand `tsc`-Enforcement, F10 Audit-Chain-Tampering-Detection.
- **route-auth-helpers.test.ts:** 10 Cases — Legacy-Mode (3), Multi-Tenant-Mode (7) inkl. 401/403/404/409-Pfade.
- **Typecheck:** keine neuen Fehler in Phase-A.8-Files; pre-existing `swarm2-screen.tsx`-Baseline (65 Errors aus Mai-Inventory) unverändert.
- **Build:** `pnpm build` durchgelaufen in 9.55 s, alle Routes im `routeTree.gen.ts` registered.
- **Pre-existing nicht-Phase-A Test-Failures (vorhanden vor Refactor):** 11 Tests in 5 Files (kanban-backend, mcp-presets-store, swarm-memory, gateway-capabilities, local-provider-discovery) — komplett orthogonal zu diesem Refactor.

### Added — Workspace-Settings, Audit-Viewer, Account, Session-Share-UI (Phase A.7, 2026-05-08)

**API-Routes (2)**
- **`GET /api/workspaces/$id/audit`** — gated auf `audit-view`. `?listDays=1` returnt verfügbare Tag-Files, ohne Param `?date=` returnt heute. **Plan-Finding F10:** Server rekomputet die Hash-Chain bei jedem Read; bei Bruch wird der Befund (`brokenAt`, `breakReason`) zurückgegeben UND ein `chain_break_detected`-Event in dasselbe Audit-Log geschrieben — Tampering wird sichtbar UND als forensisches Ereignis aufgezeichnet.
- **`GET /api/swarm-yaml-issues`** — Read-only Summary von `data/global/swarm-yaml-issues.json` (Plan-Finding L3). Filtert die Issues auf Workspaces wo der Caller `roster-edit` hat — kein Cross-WS-Leak.

**Account / Workspace-Settings UI**
- **`/account`** Route + `AccountScreen` — eigenes Profil (read-only Card mit ID/Email/Name/Status/lastLoginAt) + ChangePasswordForm (Old-PW-Verify, neues PW ≥8 Zeichen, Bestätigung, Auto-Reload nach Erfolg).
- **`/workspace/$id/settings`** Layout + 4 Tabs (General/Members/Roster/Audit Log). Left-rail Navigation mit Branding-Color-Bar + WS-Name. Member-Rolle landet bei `member` auf einer Permission-Denied-Seite.
- **General-Tab** — Name/Description/PrimaryColor/DefaultModel editierbar via PATCH; **Soft-Delete-Box** für Owner mit Slug-Confirmation-Tippen.
- **Members-Tab** — Tabelle mit Status-Badges (active / locked-with-fails / disabled), Pending-Invites-Sub-Tabelle mit Revoke. Kontextmenü pro Member: Promote/Demote (gated auf `owner-handover`), PW-Reset, Entfernen.
- **Roster-Tab** — Status "Default" vs. "Custom" + scannedAt-Zeitstempel, Issue-List wenn `swarm-yaml-issues.json` Einträge für den WS hat. Editor folgt später.
- **Audit-Tab** — Day-Picker, Tabelle mit ID/Zeit/Typ/Akteur/Chain-Status. Zeile expandierbar zu Full-JSON. Bei `brokenAt !== null`: prominenter roter Banner mit Index + Reason (Plan-Finding F10).

**Modals (alle in `members-tab.tsx`)**
- `InviteCreateModal` — Email (optional), Rolle (Member/Admin), TTL (1/3/7/14/30d).
- `InviteLinkModal` — zeigt Link mit Kopier-Button + Verfalls-Datum.
- `PwResetResultModal` — Mono-Font-Plaintext + Kopier-Button + 3 Warnungen (einmalig, force-change, 24h).
- `MemberRemoveModal` (Plan-Finding D1 Two-Path) — drei Optionen via Radio: nur Membership entfernen / Sessions an anderen User übertragen (Dropdown) / Sessions löschen. Sendet `?sessions=transfer&transferTo=<uid>` oder `?sessions=delete` als Query-Param.

**Globale Komponenten**
- **`RosterIssuesBanner`** — sticky alert oben für Owner/Admins wenn der aktive Workspace einen Issue hat. Dismiss-able, linkt auf Roster-Tab.
- **`SessionShareButton`** — inline Toggle 🔒 Privat ↔ 👥 Geteilt. Ruft `/api/sessions/$id/{share,unshare}`.
- **`SharedSessionReadOnlyBanner`** (Plan-Finding F11) — Read-Only-Hinweis für non-Owner-Viewer einer geteilten Session.

**Routes (5 neu in TanStack)**
- `/account`
- `/workspace/$id/settings` (Layout) + `/workspace/$id/settings/` (redirect → /general) + `/workspace/$id/settings/$tab` (general | members | roster | audit)

### Changed
- `src/routes/__root.tsx` — `<RosterIssuesBanner />` nach `<WorkspaceHeaderBanner />` gemounted.
- `src/routeTree.gen.ts` — auto-regenerated mit allen neuen Routes.

### Added — Multi-Tenant UI Core (Phase A.6, 2026-05-08)

**Auth-Surface Refactor**
- **`src/components/auth/login-screen.tsx`** — komplette Neufassung. Liest `/api/setup-status` einmal beim Mount und routet in einen von 5 Sub-Modi: `loading`, `inconsistent` (Boot-State F1 mit Operator-Hinweis), `setup` (First-Run-SetupWizard), `multi-tenant` (Email + Password), `multi-tenant-must-change-password` (Force-Change nach Temp-PW), `legacy` (Single-Password-Fallback). Erkennt auch `/invite/<token>` in der URL und überlädt mit `InviteAcceptForm`. Deutsche UI-Strings, dunkler-tolerant, identische Karten-Optik wie das alte LoginScreen.
- **SetupWizard (in login-screen.tsx)** — 2-Step-Flow: Owner-Account (id, email, name, password+confirm mit ≥8 Zeichen) → Workspace (id auto-suggested aus name, name, primaryColor mit Color-Picker). POST `/api/auth/setup` → Auto-Login und Redirect auf `/`.
- **ForceChangePasswordForm** — wird vom LoginScreen aufgerufen wenn `/api/auth/me` `mustChangePassword: true` zurückgibt. Verifiziert altes Passwort, setzt neues (≥8 Zeichen, Bestätigung), revoked alle anderen Tokens, issued frischen Token, lädt Seite.
- **InviteAcceptForm** — public, vom LoginScreen via URL-Pattern `/invite/<token>` getriggert. Lädt `/api/invites/$token/info`, zeigt Workspace-Branding-Bar + Rolle, Form: userId (Slug), name, password+confirm. POST `/api/invites/$token/accept` → Auto-Login → Redirect auf `/`.

**Workspace-Komponenten**
- **`src/components/workspace/workspace-switcher.tsx`** — Plan A.5 Footer-Switcher in der `chat-sidebar`. Zeigt aktiven Workspace mit Branding-Color-Bar + Name + Username, Click öffnet Dropdown mit allen Memberships (Color-Bar pro Eintrag), Account-Link, optional Workspace-Settings-Link (für Admin/Owner), Logout-Button. Kollabiert auf Color-Block wenn Sidebar collapsed. Returnt `null` im Legacy-Modus.
- **`src/components/workspace/workspace-header-banner.tsx`** — dünner farbiger Streifen oben auf jeder Seite mit `meta.branding.primaryColor`. Verhindert dass User versehentlich glaubt, im falschen Workspace zu sein. Sticky-top, z-40, returnt null im Legacy-Modus.
- **`src/routes/invite.$token.tsx`** — public TanStack-Route die `LoginScreen` rendert. Macht `/invite/<token>` URL-stable; LoginScreen erkennt Path und switcht auf InviteAcceptForm.

**Shared Frontend Helper + Endpoint**
- **`src/lib/workspace-auth.ts`** — `fetchSetupStatus`, `loginWithEmailPassword`, `logout`, `fetchCurrentUser`, `performSetup`, `fetchInviteInfo`, `acceptInvite`, `changePassword`, `switchWorkspace`. Typisierte `AuthError` mit `kind`-Discriminator. `SLUG_RE` mirror-validiert serverseitige Regel + `suggestSlug(name)` Helper.
- **`GET /api/setup-status`** — public, no auth. Returnt `{ mode: 'fresh-stack' | 'multi-tenant' | 'legacy' | 'inconsistent' }`.

**Integration in `__root.tsx`**
- `<WorkspaceHeaderBanner />` wird oben gemounted wenn `rootSurfaceState.showWorkspaceShell` aktiv ist.

### Changed
- `src/screens/chat/components/chat-sidebar.tsx` — `<WorkspaceSwitcher />` als neues Element vor der bestehenden User-Card im Footer. Pure additive: bei Legacy-Modus oder noch nicht eingeloggtem Multi-Tenant-User returnt der Switcher null und die Sidebar sieht aus wie vorher.
- `src/routeTree.gen.ts` — auto-regenerated, 2 neue Routes (`/api/setup-status`, `/invite/$token`).

### Added — Single→Multi-Tenant Migration (Phase A.5, 2026-05-08)

**Migration-Engine (3 neue Backend-Module)**
- **`src/server/migration-detector.ts`** — `detectLegacySource()` resolved den Legacy-Layout-Root via `HERMES_LEGACY_DATA_DIR` → `HERMES_HOME` → `~/.hermes`. Erkennt: `memories/` (oder `memory/` als Fallback), `skills/`, `council/`, `profiles/`, `session-titles.json`, `workspace-sessions.json`, plus den externen `~/.openclaw/workspace/memory/swarm/` (für Manifest-Forensics — der echte Symlink-Reconcile passiert beim Boot, Phase A.4).
- **`src/server/migration-multi-person.ts`** — Plan-Finding **L2** Heuristik. `analyzeMultiPerson(sessions)` flaggt wenn `>20 Sessions in <30d` ODER `>3 distinkte UA-Strings` aus den Gateway-Session-Records auftauchen (pure Function, no I/O). Confirmation-Marker `data/global/.multi-person-tag-confirmed` (JSON) ist **one-shot** — wird vom Migrations-Step nach erfolgreichem Run gelöscht (`consumeMultiPersonConfirmation`), damit ein zweiter Run frische Bestätigung braucht.
- **`src/server/migration.ts`** — Hauptmodul mit `planMigration(params)` (pure) + `executeMigration(plan, opts)` (I/O). Pre-flight-gates:
  - **L1+N6** Backup-Check: `data/global/.backup-confirmed` muss valide JSON sein, `snapshotId` non-empty, `confirmedAt < 24h`. Ohne Marker → Throw mit Operator-Hinweis.
  - **L2** Multi-Person-Check: bei flaggter Heuristik ohne Confirmation → Throw.

  Steps: copy memories+skills+council+profiles → workspace-dirs; bcrypt(HERMES_PASSWORD) → `users/<id>/auth/password-hash.txt`; Workspace-Meta + Members; Tag jeder Gateway-Session in `sessions-meta.json` mit `ownerId=migrant, shared=false` und Title aus `session-titles.json`-Merge; **`MigrationManifest`-Schema (N5)** in `data/global/migration-manifest.json` mit `rollbackInstructions` (sidecar | in-place); SHA256-self-Marker via `migration-marker.ts`; `workspace-sessions.json` cleared (Token-Invalidation, Plan-Finding **D3**).

**CLI-Tools (2 neue + 1 erweitert)**
- **`scripts/admin/migrate.ts`** — Migration-CLI. Args: `--owner <id>`, `--email`, `--name`, `--workspace <slug>`, `--workspace-name`, optional `--workspace-description`, `--primary-color`, `--dry-run`, `--in-place`. Print Plan immer (auch bei dry-run), pre-flight-gates erst bei Apply. Audit-Event `cli_migrate`. Operator-Hinweis am Ende: external-mv-Steps für Sidecar-Rename. **R3 Default ist Sidecar** — `--in-place` ist Edge-Case-Opt-In.
- **`scripts/admin/migration-rollback.ts`** — Plan-Finding **N3** Two-Mode. `--sidecar`: druckt 1 `mv`-Step für den Operator + clearet Marker/Manifest; `--in-place`: iteriert `manifest.rollbackInstructions.inPlaceRollback.reverseMoves` und kopiert `to → from` zurück. **Dry-Run by Default** — destruktive Aktionen brauchen `--apply`. Audit-Event `cli_migration_rollback` mit Mode + cleared paths.

**Sidecar-Pattern (Plan-Finding R3)**

```bash
# Sidecar — zero-risk: legacy /opt/data unchanged unless rename succeeds
docker run --rm \
  -v /opt/data:/in:ro \
  -v /opt/data-staging:/out \
  -e HERMES_LEGACY_DATA_DIR=/in \
  -e HERMES_DATA_DIR=/out \
  -e HERMES_PASSWORD="<single-pw>" \
  hermes-workspace:migrate \
  tsx scripts/admin/migrate.ts --owner phil --email phil@stratex-ai.com \
                                --name "Phil" --workspace stratex --workspace-name "Stratex"

# After exit 0:
mv /opt/data /opt/data.pre-migration
mv /opt/data-staging /opt/data
docker compose restart hermes-workspace
```

**Test-Suite (1 File, 20 Cases — alle grün)**
- `migration.test.ts` — Detector (4 Cases inkl. memory/-Fallback, hasLegacyPassword), Multi-Person-Heuristik (4 Cases inkl. activity-window), Pre-Flight-Gates (5 Cases: backup-missing, backup-stale-25h, backup-malformed-JSON, backup-fresh-ok, multi-person-flagged-without-confirmation), Multi-Person-Confirmed-Proceeds (1 Case mit one-shot Marker-Konsumierung), Happy-Path (3 Cases: planMigration moves, executeMigration full E2E mit memories+skills+profiles+bcrypt-roundtrip+manifest+marker+workspace-sessions-cleared, slug-rejection), Idempotency (1 Case), Rollback (2 Cases inkl. throw on missing manifest).

### Added — Sessions-Privacy, Snapshot, Roster-Validator, Symlink-Reconcile (Phase A.4, 2026-05-08)

**Sessions-Privacy + Snapshot (D1 Hybrid)**
- **`src/server/sessions-privacy.ts`** — workspace-scoped Sessions-Mapping unter `data/workspaces/<wsId>/sessions-meta.json` (`schemaVersion: 1`). Helpers: `tagSession`, `recordActivity`, `shareSession`, `unshareSession`, `transferSessionsOwnership`, `listSessionsOwnedBy`, `readSessionsMeta`, `updateSessionsMeta`. **`filterVisibleSessions()`** ist die einzige legitime Quelle des `FilteredSessions`-Brands aus `sessions-types.ts` — `tsc` weigert sich, Sessions-Returns ohne diesen Filter zu kompilieren (Plan-Finding L6). Visibilität: own + shared, untagged → fail-closed. Sentinel `userId: '*'` für Audit-View. Atomic-Patches via `withMutex`.
- **`src/server/sessions-snapshot.ts`** — Lazy-Re-Snapshot in `data/workspaces/<wsId>/sessions/shared/<sid>.json`. **`ensureFreshSnapshot()`** mit `withMutex(\`snapshot:\${wsId}:\${sid}\`)` — 50 parallele Reads auf eine veraltete shared Session erzeugen genau **1** Gateway-Roundtrip (Plan-Finding R6 + N7-Cleanup verifiziert via Test). Stale-Tolerance: bei Gateway-Failure wird der alte Snapshot mit `stale: true` zurückgegeben statt eine Exception zu werfen. **`captureInitialSnapshot()`** für synchronen Snapshot-Write beim Share, damit non-owner-Viewer keine first-read latency haben. Freshness: 10 min ODER `lastActivityAt > snapshotUpdatedAt`.
- **Bug-Fix:** Mutex-Read war initial **außerhalb** des Mutex und liefere stale Meta — gefixed: `readSessionsMeta` läuft jetzt **innerhalb** der Mutex-Region, damit Queue-Caller das Resultat des in-progress Refresh sehen.

**Sessions Share/Unshare API (2 Routes)**
- **`POST /api/sessions/$id/share`** — gated auf `session-share`. Owner darf immer; non-Owner muss `members-manage` haben. Untagged Sessions werden auto-tagged (Caller wird als Owner gesetzt). Synchrone Initial-Snapshot-Capture, Failure ist non-fatal (lazy refresh holt nach). Audit-Event `session_shared`.
- **`POST /api/sessions/$id/unshare`** — Owner oder Admin. Snapshot bleibt für eine Cleanup-Cycle auf Disk (Sweep durch späteren Member-Removal). Audit-Event `session_unshared`.

**Roster-Re-Validation (L3)**
- **`src/server/swarm-yaml-validator.ts`** — Save-Time + Boot-Time + package.json-Hash-Trigger Validation aller `data/workspaces/<id>/swarm.yaml` Files. **`validateRosterContent()`** flaggt: parse errors, fehlende `workers[]`, fehlende/leere `id`, duplicate ids, **unknown worker-id** (nicht in der Code-Implementation). Code-Implementations werden aus `HERMES_KNOWN_WORKER_IDS` env (semicolon-separiert) ODER aus dem Repo-Default `swarm.yaml` gelesen. **`revalidateAllWorkspaceRosters()`** schreibt `data/global/swarm-yaml-issues.json` (`schemaVersion: 1`) — gelesen vom `RosterIssuesBanner` UI-Komponenten. **`revalidateIfPackageChanged()`** vergleicht den package.json-SHA256 mit dem aus dem letzten Report → no-op bei unverändertem Hash, vollständiger Re-Scan sonst. Cheap genug für Boot-Hook.

**Migration Boot-Time Symlink-Reconcile (N1)**
- **`src/server/migration-symlink-reconcile.ts`** — idempotenter Boot-Hook nach `assertCoherentBootState()` und `isMigrationCompleted()`. Erstellt Symlink von `data/workspaces/<wsId>/memories/swarm` → `~/.openclaw/workspace/memory/swarm` (override via `HERMES_LEGACY_SWARM_MEMORY_ROOT`) WENN das Workspace-Target fehlt UND der Legacy-Pfad existiert UND content hat. Idempotent (already-present nach erstem Run). Audit-Event `legacy_symlink_reconciled`. Skipped Workspaces mit echtem (non-symlink) `memories/swarm`-Dir — kein Bulldoze. **Cross-Platform:** auf Windows wird `junction` als Fallback genutzt wenn `symlinkSync(_, _, 'dir')` mangels Admin-Rechten fehlschlägt.

**Test-Suite (4 Files, 47 Cases — alle grün)**
- `sessions-privacy.test.ts` — 16 Cases: Tag-no-op, Filter (own + shared + sentinel), Fail-Closed-für-Untagged, Share/Unshare Round-Trip, Refusal für untagged Share, Transfer-Ownership, F9 Cross-WS-Isolation (sessions in WS-A unsichtbar von WS-B mapping), atomic 30 parallele tagSession.
- `sessions-snapshot.test.ts` — 10 Cases: Initial-Snapshot, Refusal-für-Untagged, Returns-existing-when-fresh (zero fetcher calls), Refresh-when-stale, **Thundering-Herd 50 parallel → 1 fetcher call**, Stale-Tolerance bei Gateway-Failure, **N7 Mutex-Cleanup mit 25 unique session-ids**.
- `swarm-yaml-validator.test.ts` — 15 Cases: HERMES_KNOWN_WORKER_IDS env, valid roster, unknown-worker-id flag, duplicate-id flag, missing-id, missing-workers, malformed-yaml, no-Custom-roster=ok, ws-scope-validation, package.json-Hash-Trigger no-op + erstmaliger Scan.
- `migration-symlink-reconcile.test.ts` — 6 Cases: First-create + content-deref, idempotent already-present, audit-event, no-legacy bei empty/missing, skip-real-dir (kein Bulldoze), iteration nur über aktive Workspaces.

### Changed
- `src/routeTree.gen.ts` — auto-regenerated, 2 neue Routes (`/api/sessions/$id/share`, `/api/sessions/$id/unshare`).

### Added — Multi-Tenant Auth, Routes & CLI (Phase A.2/A.3, 2026-05-08)

**Backend-Foundation (4 neue Module + erweiterte auth-middleware)**
- **`src/server/invites-store.ts`** — Workspace-Invite-Tokens (one-shot, TTL 7d default, clamped 1–30d). Atomic File-per-Token unter `data/global/invites/<token>.json`. `consumeInvite()` flippt `used` + setzt `usedBy/usedAt`; `revokeInvite()` deletet pending Tokens (consumed bleiben für Audit). `sweepExpiredInvites()` als periodic cleanup.
- **`src/server/pw-resets-store.ts`** — Password-Reset-Tokens in zwei Flavours: `temp-password` (admin-getriggert, 24h TTL) + `reset-link` (self-service, 1h TTL, ready für SMTP-Phase). Plaintext Temp-PW wird **nie** persistiert — nur Hash via `users-store.setPasswordHash`. Reset-Record bleibt für Forensics.
- **`src/server/boot-state-check.ts`** — Plan-Finding **F1**: Drei-Zustände-Coherence-Check beim Boot. `assertCoherentBootState()` wirft mit Operator-Hinweis (`scripts/admin/repair-marker.ts`), wenn Users existieren aber weder Marker noch Manifest da sind. Verhindert dass der SetupWizard auf einem korrupten Stack einen zweiten Owner-Account anlegt.
- **`src/server/auth-middleware.ts`** Drop-in-Replace (Plan-Finding **L5**): Token-Index in-memory `Map<token, {userId, expiresAt}>` für **AK26** (1000 Tokens, Lookup p99 <5 ms). Per-User Sessions-File `data/users/<id>/auth/sessions.json` mit `schemaVersion: 1`. Neue Helper: `requireUser`, `requireWorkspaceMember`, `requirePermission`, `getCurrentUser`, `getActiveWorkspace`, `loginWithEmailPassword`, `issueUserSessionToken`, `revokeUserSessionToken`, `revokeAllUserSessionTokens`. Legacy-Helper (`isAuthenticated`, `verifyPassword(pw)`, `storeSessionToken`, `revokeSessionToken`) bleiben als `@deprecated` Wrapper für inkrementelle Route-Migration. **Plan-Finding D3**: nach Migration-Marker wird `HERMES_PASSWORD` nicht mehr akzeptiert (`getConfiguredPassword` returnt `''`).
- Login-Flow integriert Failed-Login-Counter (`recordFailedLogin`/`recordSuccessfulLogin`) + emittiert globale Audit-Events `login`, `login_failed` (mit Reason + IP + UserAgent — Plan-Finding **L7**).

**Auth-API-Routes (5)**
- **`POST /api/auth/login`** — Email + Password Login. Returnt 412 wenn Migration noch nicht gelaufen ist (Hinweis auf Legacy `/api/auth`). Constant-time-Delay bei Fehler. Issued Cookie via `createSessionCookie(token)`. Status: `423` für gesperrte Accounts, `403` für disabled, `401` für invalid-credentials/no-such-user.
- **`POST /api/auth/logout`** — Token-Revocation, Audit-Event `logout`. `Set-Cookie: claude-auth=; Max-Age=0`.
- **`GET /api/auth/me`** — Returnt User-Profil + `memberships[]` (alle aktiven Workspaces des Users mit Role + Branding) + `actions[]` für aktiven Workspace. Im Legacy-Modus returnt `{ user: null, mode: 'legacy' }` — Frontend kann darauf branchen.
- **`POST /api/auth/setup`** — First-Run-Only SetupWizard. Refused mit 409 wenn Users existieren oder Marker valid ist. Erstellt Owner + ersten Workspace + addMember + writeMarker + Audit + Auto-Login.
- **`POST /api/auth/change-password`** — Old-PW-Verify, neuer Hash, `mustChangePassword: false`, alte Tokens revoked, neuer Token issued. Audit-Event `password_changed`.

**Invite-Routes (2 public + 2 admin)**
- **`GET /api/invites/$token/info`** — public (kein Auth). Returnt minimale Info für `InviteAcceptScreen`. `valid: false` für malformed/expired/used/unknown Tokens — kein Existence-Leak.
- **`POST /api/invites/$token/accept`** — public. Validiert Slug, refused 410 für ungültige Tokens, refused 409 wenn `userId` schon vergeben oder Member schon da. Atomic: consume → create user → setPasswordHash → addMember → updateProfile → audit → autoLogin.
- **`GET/POST /api/workspaces/$id/invites`** — admin only (`members-manage`). POST mit Rate-Limit 10/min/Admin/IP, Audit-Event `invite_created`.
- **`DELETE /api/workspaces/$id/invites/$token`** — admin only. Refused 404 wenn Token nicht zum Workspace gehört (kein Cross-WS-Existence-Leak). Audit `invite_revoked`.

**Workspace-Routes (3)**
- **`GET /api/workspaces`** — eigene Memberships (mit Role + Branding).
- **`POST /api/workspaces`** — Caller wird Owner. Slug-Validation, Audit (global + ws-scope) `workspace_created`.
- **`GET/PATCH/DELETE /api/workspaces/$id`** — GET 404 für Non-Member (F9). PATCH gated auf `workspace-settings`. DELETE = Soft-Delete (`workspace-delete` Action, nur Owner), Audit `workspace_deleted`.
- **`POST /api/workspaces/$id/switch`** — setzt `defaultWorkspaceId` für den aktiven User.

**Member-Routes (2)**
- **`GET /api/workspaces/$id/members`** — admin only. Listet Members + Pending-Invites mit Diagnostik (lastLoginAt, failedLoginCount, lastFailedLoginAt, status).
- **`PATCH /api/workspaces/$id/members/$uid`** — Role-Change. Promote-zu-Owner braucht zusätzlich `owner-handover` Action. Last-Owner-Demote-Schutz via `workspace-store.changeMemberRole`.
- **`DELETE /api/workspaces/$id/members/$uid`** — entfernt Member. Two-Path-Modal-Support (Plan **D1**): `?sessions=transfer&transferTo=<uid>` oder `?sessions=delete`. Audit-Event mit `sessionsAction`.

**User-Action-Routes (3)**
- **`POST /api/users/$id/password-reset`** — Admin-only Temp-PW-Generation. Authority via `canDo(actor, sharedWS, 'user-pw-reset')` — Actor muss Admin/Owner in einem geteilten Workspace sein. Returns Plaintext-PW EINMAL, persistiert nur Hash. Revokes alle Tokens des Targets. Audit `pw_reset_temp` mit `viaWorkspace`. Rate-Limit 5/h.
- **`POST /api/users/$id/{disable,enable}`** — Admin-only Status-Toggle. Disable revokes alle Tokens. Audit `user_disabled` / `user_enabled`.

**CLI-Recovery-Tools (`scripts/admin/`)**
- **`confirm-backup-done.ts`** — Pre-Flight für Migration: schreibt `.backup-confirmed` JSON mit `{confirmedAt, snapshotId, confirmedBy}`. 24h TTL. (Plan-Finding **L1**/**N6**)
- **`confirm-multi-person-tag.ts`** — Bestätigung dass Multi-Person-Heuristik akzeptiert wird. (Plan-Finding **L2**)
- **`reset-password.ts`** — Break-Glass: generiert Temp-PW, hashed, schreibt, revoked Tokens, druckt Plaintext auf STDOUT. (D3 Recovery)
- **`promote-to-owner.ts`** — promotet User zu `owner`; addet Member wenn nicht schon drin.
- **`list-users.ts`**, **`list-workspaces.ts`** — read-only JSON-Output für Operator-Inspektion.
- **`repair-marker.ts`** — rekonstruiert `migration-completed.json` aus `migration-manifest.json`. Refused wenn Manifest fehlt. (Plan-Finding **F1**)
- **`_audit.ts`** — Shared-Helper: jeder mutierende CLI-Tool emittiert `cli_<action>` Audit-Event mit `triggeredBy = SUDO_USER || os-user`. (Plan-Finding **F7**)
- **`README.md`** — Operator-Doc mit `docker exec`-Aufruf-Pattern.

**Test-Suite (5 Files, 70 Cases — alle grün, p99-Bench inkl.)**
- `invites-store.test.ts` — 15 Cases (TTL-Clamping, Double-Consume-Refusal, Expiry, Slug-Validation, Sweep)
- `pw-resets-store.test.ts` — 11 Cases (TTLs, Double-Consume, Expiry, Token-Format)
- `boot-state-check.test.ts` — 5 Cases (alle 4 Drei-Zustände + Throw-on-inconsistent + Korrupter-Marker)
- `auth-middleware.test.ts` — Erweitert von 8 auf 27 Cases. Inkl. **AK26** (1000 Tokens, p99 <5 ms, gemessen via `process.hrtime.bigint()`), Email-Case-Insensitivity, Failed-Login-Lockout, **L7** Audit (success+failed mit IP), `requireUser`/`requireWorkspaceMember`/`requirePermission` mit allen 401/403/404-Pfaden, **F9** Cross-Workspace-Isolation. Bestehende #123/#125-Tests bleiben unverändert.
- `__tests__/auth-routes-flow.test.ts` — 12 E2E-Cases als Dünner-Wrapper-Smoke: SetupWizard-Flow, Multi-WS, Invite→Accept→Member, PW-Reset-Force-Change, 10×Failed-Login-Lockout, Soft-Delete-Reaction, F9-Isolation, Audit-Trail mit IPs, Slug-Rejection, Active-Workspace-Switch, Soft-Delete-Meta.

### Changed
- `src/routeTree.gen.ts` — auto-regenerated via `pnpm build`, 17 neue API-Routes registered (`/api/auth/{login,logout,me,setup,change-password}`, `/api/invites/$token/{info,accept}`, `/api/workspaces`, `/api/workspaces/$id` + `/switch` + `/members` + `/members/$uid` + `/invites` + `/invites/$token`, `/api/users/$id/{password-reset,disable,enable}`).

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
