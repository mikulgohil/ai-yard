# AI-yard — Improvements Backlog

Generated 2026-05-07 after a full architectural read of the codebase. Companion to `docs/RENAME.md` (rename-specific debt) — this file tracks ongoing engineering improvements unrelated to the rename.

**How to use this file**

- Tiered by leverage ÷ effort. Tier A items are quick wins; Tier B/C/D require dedicated sessions.
- Each item has a status checkbox, current state, action plan, and acceptance criteria.
- When you finish an item, tick the box and append a short note (date + outcome).
- Don't span multiple tiers in one session. Pair one Tier A with one Tier B at most.

---

## ⏭️ Next session (pick up here)

**Primary task: A5 Phase 5 — WebContentsView cutover.** Phases 1–4 are done (see decision log entries below for context). Phase 5 is mostly manual smoke-testing during a live `npm run dev` because every prior session was blocked by the harness's inability to launch Electron interactively.

### Phase 5 — concrete steps

1. **Flip the default** — `src/renderer/components/browser-tab/pane.ts:199`, change `useWebContentsView = false` → `true`.
2. **Live-launch parity check** (the part every prior session deferred):
   - New browser tab loads at the placeholder's bounds.
   - Inspect Element → click DOM node → inspect panel populates with selectors.
   - Record (flow) → click DOM node → flow picker popover; "Click + Record" appends a step.
   - Draw → drag → release → draw popover at cursor.
   - Global accelerators (`Cmd/Ctrl+W/T/F/P/[/]/Shift+[/]/…`) fire the app shortcut without the page double-handling.
   - Universal text-editing combos (`Cmd/Ctrl+S/Z/C/V/X/A/R`) still reach the page.
3. **Delete the legacy path** once parity is confirmed:
   - Remove the `<webview>` branch in `pane.ts:199-215` (the `useWebContentsView ? … : (() => { … })()` ternary collapses to a single `createWebContentsViewAdapter(…)` call).
   - Delete `createWebviewAdapter` and the `WebviewElement` type from `view-adapter.ts` + `types.ts`.
   - Delete the legacy `setPreload` block in `pane.ts:493-498` (the WCV adapter handles preload at create time).
   - Set `webviewTag: false` in `src/main/main.ts` (search for `webviewTag: true`).
   - Remove the `useWebContentsView` field from `BrowserTabInstance` in `types.ts`.
4. **Append a decision-log entry** under the existing 2026-05-07 entries with: parity check results, any accelerators that misbehaved, final test/lint/build numbers, bundle size after the legacy path is deleted (expected to drop a bit since `createWebviewAdapter` is removed).

**Estimated effort**: 1–2 hours, almost all of it manual smoke-testing.

### Known Phase 5 gaps to either close or document

- **User-customized keybindings** aren't synced to main — non-default accelerators still fire our handler but the page also sees the keystroke. Fix is ~60 LoC (contract field + renderer observer + main cache). Optional for Phase 5; only blocks if a real user reports it.
- **Linux device-pixel scaling** — Phase 3 used CSS-pixel rects (works on macOS/Windows). Linux may need device-pixel adjustment in `computeRect()` if we ever test there. Not a Phase 5 blocker.
- **`view-adapter.test.ts`** doesn't exercise the `toPNG` path of the WCV `capturePage` shim against a real PNG payload — live launch will validate.

### Other items still open (not Phase 5)

Pick one of these up *after* Phase 5 lands:

- **B6** — typed IPC bridge (scaffolded only; ~80 channels need migrating in one PR — half-typed surface is worse than untyped).
- **B8** — SQLite migration (schema in `src/main/store-sqlite-schema.sql`; no code yet — 1–2 day session).
- **C11** — CDP console capture (was blocked on A5; unblocked once Phase 5 is done).
- **C12** — MCP server marketplace UI (registry published; runtime UI not built).
- **C17** — Jira integration for kanban + project overview (3-slice plan; user-asked).
- **Pre-existing vitest+vite-7 resolver regression** — 37 main-process test files fail to load (`Failed to resolve entry for package "fs"`). Codemod to `node:`-prefixed imports is the recommended fix. Not blocking any feature, but should be done before B8 lands (B8 will add new tests subject to the same issue).
- **Telemetry/Sentry secrets provisioning (operational)** — code is wired, just needs `gh secret set SENTRY_DSN / TELEMETRY_ENDPOINT / TELEMETRY_WEBSITE_ID`. First release after the secrets land is the first one with active reporting.

---

## Tier A — Quick wins (each <1 day, high ROI)

### A1. Add a linter (Biome)

- **Status**: [x] done 2026-05-07
- **Why**: `CLAUDE.md` records "No lint tooling is configured." 18k LOC of TypeScript with zero lint guarantees a backlog of unused imports, unreachable branches, and silent `any` leaks. Biome over ESLint here — single binary, ~10× faster, no plugin config sprawl.
- **Current state**: No lint configuration anywhere in repo.
- **Plan**:
  1. `npm i -D @biomejs/biome`
  2. Add `biome.json` with TypeScript-strict defaults: `noExplicitAny`, `noUnusedVariables`, `noUnusedImports`. Ignore `dist`, `node_modules`, `coverage`, `build`.
  3. Add scripts: `lint` (`biome check src/`), `lint:fix` (`biome check --write src/`).
  4. Run once and capture the warning count. Auto-fix what's safe; keep the rest as a follow-up.
  5. Wire into CI as a non-blocking step initially (warn-only); promote to blocking after the cleanup pass.
- **Acceptance**: `npm run lint` returns. New code triggers lint warnings on save (editor integration is the user's job).
- **Notes**: Biome doesn't yet handle every ESLint plugin (e.g. import sorting). For this codebase that's fine.
- **Outcome (2026-05-07)**:
  - Added `@biomejs/biome@2.4.14` and `biome.json` (linter only, formatter disabled).
  - Disabled `noNonNullAssertion` (817 hits, intentional `!` usage in this codebase) and `useNodejsImportProtocol` (169 hits, codebase uniformly uses bare `'fs'`/`'path'`).
  - `npm run lint` and `npm run lint:fix` scripts added.
  - **Auto-fix run**: 232 files cleaned. All 1526 tests still pass.
  - **Residual to fix later**: 49 errors + 28 warnings.
    - Top categories: `useIterableCallbackReturn` (34), `noAssignInExpressions` (8), `noControlCharactersInRegex` (6), `noBannedTypes` (6), `noGlobalIsNan` (4), `noExplicitAny` (17 warn), `useLiteralKeys` (15 warn).
  - Lint is **not** wired into CI yet — promote to blocking once residual is cleaned.

### A2. Minify the renderer bundle

- **Status**: [x] done 2026-05-07
- **Why**: `dist/renderer/index.js` is 1.8 MB (per `RENAME.md`). esbuild is run without `--minify`. Cold-launch faster, less memory, smaller release artifacts.
- **Current state**: `package.json:44` has `--bundle --sourcemap` but no `--minify`.
- **Plan**:
  1. Switch `build:renderer` to `--minify-syntax --minify-whitespace --legal-comments=none`. Keep identifier names readable so stack traces stay useful.
  2. Keep external `.js.map`. DevTools maps unchanged.
  3. Compare bundle size before/after; record in this doc.
- **Acceptance**: Bundle size drops ≥30%. App still launches and renders identically. Tests pass.
- **Outcome (2026-05-07)**:
  - Added `--minify-syntax --minify-whitespace --legal-comments=none` to `build:renderer`.
  - Bundle size: **1.9 MB → 1.3 MB** (~32% reduction).
  - Identifiers preserved so production stack traces remain readable without the sourcemap.
  - Sourcemap still external (`.js.map`, ~4.9 MB) — DevTools resolves it as before.

### A3. Audit and tighten CSP

- **Status**: [x] done 2026-05-07
- **Why**: I initially flagged "no CSP" — that was wrong. CSP exists at `src/renderer/index.html:5`. But two directives are loose: `connect-src http: https:` and `frame-src *`. Tightening them shrinks blast radius if any sanitizer (DOMPurify, marked) is bypassed.
- **Current state**: `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; img-src 'self' data: blob: https:; connect-src 'self' http: https:; frame-src *;`
- **Plan**:
  1. Audit every `fetch`/XHR call in renderer to enumerate connect destinations. GitHub raw fetches go through `gh` CLI (main process), so renderer-side connections are limited. WebRTC peer connections need a STUN/TURN server allowlist.
  2. Browser tab uses `<webview>`, which is its own isolated WebContents — does **not** flow through page CSP. So `frame-src *` is currently unused; can drop to `'none'`.
  3. `style-src 'unsafe-inline'` is needed for xterm/gridstack inline styles. Document why it stays.
- **Acceptance**: CSP narrowed to actual usage. Each `'unsafe-*'` token has an inline comment justifying it.
- **Outcome (2026-05-07)**:
  - Audit found four renderer network destinations: `api.github.com` (team personas list), `raw.githubusercontent.com` (persona download), `github.com` (discussions atom feed), `'self'` (CHANGELOG.md). WebRTC STUN traffic is not gated by `connect-src`.
  - No `<iframe>` usage in renderer; `<webview>` is a separate WebContents not subject to page CSP.
  - Tightened `connect-src` from `'self' http: https:` to `'self' https://api.github.com https://raw.githubusercontent.com https://github.com`.
  - Tightened `frame-src` from `*` to `'none'`.
  - Added `object-src 'none'` and `base-uri 'self'` for additional hardening.
  - Inline justification comment added to `index.html` documenting each `'unsafe-*'` and remote-host directive.
  - **Caveat for GitHub Enterprise users**: connect-src would block their Enterprise instance. If that becomes a use case, switch to `https:` for connect-src or make the host configurable.

### A4. Resolve the auto-updater publish gap

- **Status**: [x] done 2026-05-07 (path b: keep dormant)
- **Why**: `auto-updater.ts` is wired into `main.ts:121`, but `RENAME.md` records that the `electron-builder.publish` block was stripped during the rename. In packaged builds the updater starts polling and silently fails ("no provider configured"). Either re-publish or stop polling — pick one.
- **Decision needed from user**:
  - (a) Re-add a `github` publish target pointing at `mikulgohil/ai-yard` releases. Implies you'll cut releases there.
  - (b) Keep the updater dormant (early-out on no `publish` config). Document with a comment.
  - (c) Remove `auto-updater.ts` entirely and the IPC channels it publishes. Smallest surface, smallest risk.
- **Recommended**: (b) for now (least churn), promote to (a) once the GitHub repo and CI are in place per `docs/RENAME.md` Tier 2.
- **Outcome (2026-05-07)** — chose path (b):
  - Added an explicit `updaterConfigured = false` early-return in `initAutoUpdater()` with an inline comment pointing at this doc and `docs/RENAME.md` Tier 2.
  - Existing IPC entry points (`checkForUpdates`, `quitAndInstall`) still delegate to `autoUpdater` so they remain functional if/when manually invoked.
  - Updated `auto-updater.test.ts`: 6 tests asserting "registers listeners + schedules check" replaced by one test asserting `initAutoUpdater()` is a no-op while dormant. The original tests are preserved in git history and should be restored when the publish target is re-added.
  - Test count: 1526 → 1521 (net −5 from the consolidation, no test loss in coverage of currently-active code paths).

### A5. webview → WebContentsView migration

- **Status**: [~] in progress — Phases 1, 2, 3, 4 done 2026-05-07; Phase 5 (cutover) pending
- **Scaffolding**: `docs/MIGRATION_WEBVIEW.md` documents the 5-phase migration (adapter interface → IPC channels → repositioning → preload → cutover) with 7-12 hour estimate, affected files, and pitfalls. Phase 1 + Phase 2 sections are marked done in that doc.
- **Phase 1 outcome (2026-05-07)** — adapter interface landed:
  - New `src/renderer/components/browser-tab/view-adapter.ts` defines `ViewAdapter` and `createWebviewAdapter(webview)`. All ~30 `<webview>` call sites in `browser-tab/*.ts` now go through the adapter.
  - No behavior change. Phase 1 is a pure refactor; the second adapter implementation lives behind a flag in Phase 2.
- **Phase 2 outcome (2026-05-07)** — WebContentsView IPC channels + dormant adapter:
  - New `src/shared/browser-view-contract.ts` — pure type-only module exporting `BROWSER_VIEW_CHANNELS` (single source of truth for channel names) plus payload + event types. Both main and renderer pin against this; no Electron types leak into the renderer.
  - New `src/main/ipc/browser-view.ts` (~200 LoC) — owns `Map<viewId, {view, window, cleanups}>`, registers all `browser-view:*` handlers, attaches `webContents` listeners on create and releases them on destroy. Broadcasts `did-navigate` / `did-navigate-in-page` / `ipc-message` / `before-input-event` over a single `browser-view:event` channel; renderer filters by `viewId`. Registered via `registerBrowserViewIpcHandlers()` from `ipc-handlers.ts`.
  - New `src/main/ipc/browser-view.test.ts` — 15 tests covering contract coverage, create/destroy, every handler, and broadcast event payloads. Mocks the entire `electron` module; uses `vi.fn(function() {...})` (not arrow) so `new WebContentsView()` is constructable under the mock.
  - `src/preload/preload.ts` — adds `browserView` namespace (11 invoke wrappers + `onEvent(viewId, cb)` filtered subscriber).
  - `src/renderer/types.ts` — mirrors the `browserView` namespace types.
  - `src/renderer/components/browser-tab/view-adapter.ts` — adds `createWebContentsViewAdapter`. Accepts `preloadPath: string | Promise<string>` so callers don't need to await `getBrowserPreloadPath()` first; queues every method invocation until both the path and the main-process create call resolve. `capturePage()` returns a `{ toDataURL, toPNG }` shim because NativeImage cannot cross IPC.
  - `src/renderer/components/browser-tab/types.ts` — adds `useWebContentsView: boolean` to `BrowserTabInstance`.
  - `src/renderer/components/browser-tab/pane.ts` — branches between the two adapters behind `const useWebContentsView = false`. Default off; behavior unchanged for every existing tab. Phase 5 will flip the default.
  - `src/renderer/styles/browser-tab.css` — adds `.browser-webcontents-placeholder` rules so the placeholder participates in flex layout (Phase 3 will drive `setBounds` from this element's `getBoundingClientRect`).
  - **Tests**: 1077 → 1092 (+15). 37 file load failures unchanged (pre-existing vitest+vite-7 resolver regression).
- **Phase 3 outcome (2026-05-07)** — repositioning landed:
  - `createWebContentsViewAdapter` now owns a `ResizeObserver` on the placeholder element plus a `window.resize` listener. Both feed a single rAF-debounced `flushBounds()` that pushes rounded CSS-pixel rects through the existing `browser-view:setBounds` channel.
  - `lastSentRect` dedup elides redundant pushes (observer firing with unchanged geometry after layout settles).
  - Tab show/hide handled via `placeholder.offsetParent === null` inside `computeRect()` — when the parent pane gets `.hidden`, the rect collapses to `{0,0,0,0}` and the native view disappears without removeChildView churn.
  - Initial bounds pushed once `create` resolves so newly-opened tabs render at the right size without waiting for a resize.
  - `destroy()` cancels any pending rAF, disconnects the observer, removes the window listener, then proceeds to the existing IPC teardown.
  - `viewId` does **not** leak out of the adapter — Phase 4 wiring stays unaware of it.
  - Tests: 1092 → **1101 (+9 in `view-adapter.test.ts`)**. 37 file load failures unchanged. New file passes cleanly because it has no Node-builtin imports.
  - Bundle under default flag: 1,157.60 kB (zero change — WCV branch is dead code). With the flag flipped: 1,159.20 kB.
- **Phase 4 outcome (2026-05-07)** — preload + keybinding suppression landed:
  - `src/preload/browser-tab-preload.ts` — `bubbleHostMessage(channel, payload)` helper dual-emits `sendToHost` AND `send`. Replaces the three `ipcRenderer.sendToHost` call sites (`draw-stroke-end`, `element-selected`, `flow-element-picked`). Works for both adapters with no runtime detection: the wrong emit is a silent no-op in each context. The seven inbound `ipcRenderer.on(...)` listeners (`enter-inspect-mode`, etc.) need no change — `webContents.send` from main fires them identically under `<webview>` and `WebContentsView`.
  - `src/main/ipc/browser-view.ts` — `before-input-event` listener now calls `event.preventDefault()` synchronously for keystrokes matching `isAppAccelerator(input)`, which mirrors the static accelerators in `src/renderer/shortcuts.ts:SHORTCUT_DEFAULTS`. Skips universal text-editing combos (Cmd/Ctrl+S/Z/Y/C/V/X/A/R) so embedded pages keep their save/undo/copy. Skips bare keys, Alt-modified keys, and `keyUp` events. Synchronous suppression is necessary because the renderer-side `preventDefault` on the broadcast event arrives after the page handler has already run.
  - **Known limitation** — user-customized keybindings (`Preferences.keybindings`) aren't synced into main, so a non-default accelerator still fires our handler but the page also sees the keystroke. Fix is ~60 LoC across contract + preload + main + renderer observer. Deferred — flag if real users hit it.
  - **Tests**: 1101 → 1109 (+8 in `browser-view.test.ts` covering the matcher + suppress-and-broadcast path). 37 file load failures unchanged.
  - **Bundle**: zero change under default flag (1,157.60 kB). With flag flipped: 1,159.20 kB (matches Phase 3 delta — Phase 4 didn't touch the renderer's adapter dispatch shape).
  - Could not launch Electron interactively from this session, so visual confirmation that inspect/draw/flow IPC roundtrips work against the live native view is deferred to the first user `npm run dev` after Phase 5.
- **Phase 5 (next)** — cutover: flip `useWebContentsView` default to `true`, prove parity by exercising inspect/draw/flow + global accelerators against the live native view, delete the `<webview>` adapter, set `webviewTag: false` in `main.ts`.
- **Why**: `<webview>` is officially "discouraged, will eventually be removed" in Electron docs. `WebContentsView` (Electron 30+) is the supported replacement.
- **Acceptance**: All browser-tab features pass with no `<webview>` usage. `webviewTag: false` in `main.ts`. Existing browser-tab tests pass.

---

## Tier B — Architectural investments (1–3 days each)

### B6. Type-safe IPC bridge

- **Status**: [s] scaffolded 2026-05-07 — contract file created with one example channel
- **Scaffolding**: `src/shared/ipc-contract.ts` defines `IpcContract`, `IpcInput`, `IpcOutput`, `IpcHandler` types with `store:load` / `store:save` migrated as a worked example. Adopting requires migrating all ~80 channels in one PR — a half-typed surface is worse than the current hand-typed one.
- **Why**: `window.aiyard` is hand-typed in `src/renderer/types.ts` and mirrored by string-keyed `ipcMain.handle` calls in `src/main/ipc-handlers.ts` (660 lines). Drift between the two is silent until runtime. A typed router eliminates a whole bug class.
- **Current state**: `preload.ts` exposes namespaces via `contextBridge.exposeInMainWorld('aiyard', { pty, session, store, fs, provider, menu, github, mcp, share, ... })`. Each method calls `ipcRenderer.invoke(channel, ...args)` matched by an `ipcMain.handle(channel, handler)` somewhere in `ipc-handlers.ts`.
- **Design sketch**:
  ```ts
  // src/shared/ipc-contract.ts — single source of truth
  export const ipcContract = {
    'pty:write':    { in: z.object({ id: z.string(), data: z.string() }), out: z.void() },
    'store:save':   { in: persistedStateSchema, out: z.void() },
    'github:listPRs': { in: z.object({ repo: z.string() }), out: z.array(prSchema) },
    // ... ~80 channels
  } as const;

  // preload.ts — generic invoker, fully typed
  function invoke<C extends keyof typeof ipcContract>(channel: C, input: In<C>): Promise<Out<C>>;

  // main/ipc/router.ts — register handlers; missing/extra channels = compile error
  registerHandlers({
    'pty:write': async ({ id, data }) => { /* ... */ },
    // ...
  });
  ```
- **Why deferred**: ~150 LOC infra + converting 660 LOC of handlers + updating every renderer call site. Done in one go to avoid a half-typed surface area.
- **Acceptance**: Adding a new IPC channel is a one-line schema entry; both client and server type-error if either side is missing.

### B7. Split `ipc-handlers.ts` by feature

- **Status**: [~] partially done 2026-05-07 — 3 of ~8 modules extracted
- **Why**: 660-line god file mixes PTY, store, FS, provider, MCP, GitHub, share, session-search handlers. Hard to navigate, every change touches the same hot file.
- **Plan** (after B6 lands, to avoid re-doing the work):
  - `src/main/ipc/pty.ts`
  - `src/main/ipc/store.ts`
  - `src/main/ipc/fs.ts`
  - `src/main/ipc/provider.ts`
  - `src/main/ipc/mcp.ts`
  - `src/main/ipc/github.ts`
  - `src/main/ipc/share.ts`
  - `src/main/ipc/session-search.ts`
  - `src/main/ipc/index.ts` re-exports `registerIpcHandlers`.
- **Acceptance**: `ipc-handlers.ts` becomes a barrel file ≤30 lines. No behavior change. All tests pass.
- **Outcome (2026-05-07)** — partial extraction:
  - `src/main/ipc/fs.ts` (259 lines): all `fs:*` handlers + the security helpers `isAllowedReadPath` / `isWithinKnownProject`. Exports them so future modules can reuse the path checks.
  - `src/main/ipc/git.ts` (73 lines): all 12 `git:*` handlers.
  - `src/main/ipc/github.ts` (20 lines): all 4 `github:*` handlers.
  - `ipc-handlers.ts` shrunk from **660 → 354 lines** (46% reduction). Calls `registerFsIpcHandlers()`, `registerGitIpcHandlers()`, `registerGithubIpcHandlers()` at the bottom of `registerIpcHandlers()`.
  - All 1531 tests pass; build clean; lint unchanged.
- **Still in `ipc-handlers.ts` (deferred to a later pass)**:
  - `pty:*` (6 handlers including the 60-line `pty:create` setup)
  - `store:*` (2)
  - `provider:*`, `claude:getConfig`, `config:watchProject`, `settings:*` (~8)
  - `session:*` (2)
  - `app:*`, `menu:rebuild`, `clipboard:write`, `browser:saveScreenshot`, `update:*`, `stats:getCache`, `readiness:analyze` (~10)
  - `mcp:*` (2 + `registerMcpHandlers()`)
  - These weren't extracted because the smaller groups (`store`, `clipboard`) don't justify their own files yet, and `pty:create` has substantial inlined logic that's worth touching only as part of the typed-IPC migration (B6).

### B8. Migrate state to SQLite

- **Status**: [s] scaffolded 2026-05-07 — schema written, no code yet
- **Scaffolding**: `src/main/store-sqlite-schema.sql` is the full DDL: `projects`, `sessions`, `kanban_columns`, `kanban_tasks`, `team_members`, `preferences`, `insight_dismissals`, `readiness_snapshots`, `transcripts_fts` (FTS5), `schema_version`. Walks through PRAGMAs (foreign_keys ON, journal_mode WAL) and indexes. To wire: install `better-sqlite3`, write a v1-JSON → v2-SQLite migrator, replace `store.ts` write paths.
- **Why**: `~/.ai-yard/state.json` rewrites the entire blob on every debounced save. Once a power user has 50+ archived sessions, that file is multiple MB and writes block the main process. SQLite gives per-row updates, transactional safety, FTS5 full-text search over transcripts (replacing custom indexer in `session-deep-search.ts`), and powers historical queries (cost trends, session inspector timelines).
- **Design notes**:
  - Library: `better-sqlite3` (synchronous, fast, well-supported in Electron).
  - File: `~/.ai-yard/state.db`. Old `state.json` becomes one-shot import source.
  - Schema (rough):
    - `projects(id, name, path, overview_layout_json, github_last_seen_json, ...)`.
    - `sessions(id, project_id, provider_id, name, cwd, status, created_at, ...)` — both active and archived.
    - `kanban_tasks(id, project_id, column_id, title, tags_json, ...)`.
    - `team_members(id, name, ...)` — global, not per-project.
    - `transcripts_fts` — FTS5 virtual table over normalized transcript text.
  - Migration: on first run with v2, read v1 JSON, populate DB inside a transaction, rename JSON → `.bak`. If DB exists, ignore JSON.
- **Why deferred**: Touches `store.ts`, every `loadState`/`saveState` consumer, the persistence schema, and tests. 1-2 day focused session.
- **Acceptance**: `state.db` replaces `state.json`. Power-user benchmark (50 sessions, 100 archived): save latency ≤5 ms (currently grows linearly). FTS5 search returns in ≤50 ms over 10k transcript lines.

### B9. Renderer hot reload via Vite

- **Status**: [x] done 2026-05-07
- **Why**: Today every renderer change requires `npm run build` + Electron restart. Vite gives HMR for the renderer (sub-1s reload, no restart) without changing main/preload. Pure DX win.
- **Why plain Vite, not electron-vite (deviation from doc)**: `electron-vite dev` requires a `main` config to launch Electron, which conflicts with the "keep main/preload on tsc" constraint. Plain Vite handles renderer-only HMR cleanly while leaving the existing `tsc` builds untouched. The env var name is also `ELECTRON_RENDERER_URL` in electron-vite (not `ELECTRON_VITE_DEV_SERVER_URL` as the original plan claimed); we use `VITE_DEV_SERVER_URL` set explicitly via `cross-env` instead. The `electron-vite.config.draft.ts` is left in place as a forward-looking artifact but is no longer referenced.
- **Outcome (2026-05-07)**:
  - Added `vite ^7.0.0`, `concurrently ^9.2.0`, `cross-env ^10.0.0`, `wait-on ^9.0.0` as devDeps. `esbuild` retained for the legacy fallback.
  - **New** `vite.renderer.config.ts` (root `src/renderer`, `publicDir: src/renderer/.vite-public`, `outDir: dist/renderer`, `base: './'`). Renamed from `vite.config.ts` so vitest's auto-config-load doesn't pick it up — passed explicitly via `--config vite.renderer.config.ts`.
  - **New** `scripts/copy-vite-public.js` populates `src/renderer/.vite-public/` (gitignored) with xterm.css, vendor/gridstack.min.css, icon.png, CHANGELOG.md, and assets/providers/ — the static files index.html references via `<link>`/`<img>`. Vite serves this dir at root in dev and copies it into outDir during build.
  - `scripts/copy-assets.js` (legacy esbuild path) now rewrites `<script type="module" src="./index.ts">` back to `<script src="index.js">` when copying index.html, so the legacy IIFE bundle still loads.
  - `src/renderer/index.html` script tag is now `type="module" src="./index.ts"` (Vite's contract). CSP `connect-src` adds `ws://localhost:5173 http://localhost:5173` for Vite's HMR WebSocket — localhost-scoped, no production exposure.
  - `src/main/main.ts` branches: `process.env.VITE_DEV_SERVER_URL` → `loadURL`; else `loadFile`.
  - `package.json` scripts:
    - `dev` is now HMR mode — `concurrently` runs `tsc --watch` for main+preload, `vite --config vite.renderer.config.ts`, and Electron (after `wait-on http://localhost:5173 file:dist/main/main/main.js file:dist/preload/preload/preload.js`).
    - `dev:legacy` — old behavior (build + launch).
    - `build:renderer` is now Vite (default).
    - `build:renderer:legacy` — esbuild fallback (rollback path).
    - `build:legacy` — full legacy build chain.
- **Verified**:
  - `npm run build` — clean. **Bundle 1.4 MB (esbuild) → 1.15 MB (Vite)**, 18% smaller.
  - `npm run build:legacy` — clean. HTML script tag rewritten to legacy IIFE form. Static assets copied to `dist/renderer/`.
  - `npm run lint` — clean.
- **Test situation (pre-existing regression, not caused by B9)**: 37 main-process test files fail with "Failed to resolve entry for package 'fs'". Reproducible with the original `package-lock.json` reverted, so it's not a B9 effect. Cause: vitest 4.x + vite 7.x stricter ESM resolver doesn't externalize bare Node-built-in imports (e.g. `import * as fs from 'fs'`). Codebase uniformly uses bare imports (per `CLAUDE.md`), so this surfaces broadly. Fix path is independent of B9 — either codemod to `import * as fs from 'node:fs'` or pin vitest to a known-good resolver version. **1077 tests in 83 files pass** (the renderer side, which doesn't import Node built-ins, is unaffected).
- **Follow-ups not done this session**:
  - Manual HMR verification in Electron — the script syntax + dependency installs are validated; the actual sub-1s reload was not driven from this session because launching Electron blocks. First user run of `npm run dev` is the proof.
  - The codemod for Node built-in imports (separate from B9; see test situation above).
  - `npm run dist` (electron-builder packaged build) was not run — should be verified before next release.

---

## Tier C — Product moves (each is a feature)

### C10. Cross-session cost dashboard

- **Status**: [x] done 2026-05-07
- **Why**: Per-session cost is solid (`session-cost.ts`). No aggregate view existed. Cost-conscious devs would star a tool that surfaces daily/weekly burn, per-project breakdown, per-provider, peaks.
- **Decisions**:
  - New tab type `cost-dashboard`, registered like `kanban` and `team` (full-page surface; mirrors the kanban directory layout).
  - All three granularities supported (daily / weekly / monthly) via segmented toggle.
  - Per-project (default) + global toggle ("All projects").
  - Pref `costDashboardEnabled` (default `true`) gates the sidebar button per `CLAUDE.md` planning rule.
- **Outcome (2026-05-07)**:
  - New module `src/renderer/cost-aggregator.ts` (~280 LoC). Pure-logic module: combines live cost from `session-cost.getCost()` with `ArchivedSession.cost` (per-project history). Buckets by day/ISO-week/month using local time. Fills zero gaps for honest spend-over-time visualization.
  - New tab type `'cost-dashboard'` added to `SessionType` in `shared/types.ts`. Wired through `state/session-factory.ts` (`buildCostDashboardSession`), `state.ts` (`openCostDashboardTab`, rename guard), `components/split-layout.ts` (5 branches: create/render-pre-pass/hide-all-x2/attach), `components/tab-bar.ts` (3 branches: + menu exclusion, rename guard, render badge).
  - New components in `src/renderer/components/cost-dashboard/`: `instance.ts`, `pane.ts`, `dashboard-view.ts` (the full UI: KPI row, scope/granularity toggles, vanilla SVG bar chart with tooltips + value labels, by-provider/by-project/top-runs breakdown grid).
  - New `src/renderer/styles/cost-dashboard.css` — uses CSS variables only, no hardcoded colors. Added to `styles.css` import list.
  - Sidebar gets a "Cost" action button between Team and Files; gated on `appState.preferences.costDashboardEnabled !== false`. Sidebar already listens to `preferences-changed`, so toggling the pref live-updates without restart.
  - Preferences modal gets a "Show Cost dashboard sidebar button" toggle in the General section (above the Privacy subheading). On by default.
  - 10 new tests in `cost-aggregator.test.ts` cover: empty state, scope filtering, live + archived merge, zero-cost skip, provider/project grouping, top-runs cap, daily/weekly/monthly bucketing, ISO-week boundaries, chronological ordering. All timezone-stable (noon UTC fixtures).
  - Test count: 1566 → 1576.
- **Follow-ups not done this session**:
  - **No persisted dashboard preferences** — granularity and scope reset to defaults each app launch. Could persist to `Preferences` if the user ends up wanting it.
  - **No date-range picker** — chart shows all available data filled with zero gaps. For very long-running projects this could grow unwieldy; a "last 30 days / 12 weeks / 12 months" filter would help.
  - **B8 SQLite migration** would enable richer trends (per-day model breakdown, etc.) — the current dashboard reads `ArchivedSession.cost` which only tracks aggregate totals.

### C11. Browser tab + CDP console capture

- **Status**: [ ] feature backlog
- **Why**: The browser tab + element inspect → AI prompt is already a differentiator. Adding "console errors / network failures / perf warnings" as auto-attached context turns it from "click element" into "the page broke, here's why" — no comparable feature in any IDE I know of.
- **Sketch**: After A5 (`WebContentsView`), enable the Chrome DevTools Protocol on the underlying `webContents`. Subscribe to `Console.messageAdded`, `Network.responseReceived` (filter 4xx/5xx), `Performance.metrics`. Buffer last N events; flush into prompt context on "Ask AI".
- **Dependencies**: Best built on top of A5 migration.

### C12. MCP server marketplace UI

- **Status**: [ ] feature backlog
- **Why**: `mcp-add-modal.ts` and `mcp-inspector.ts` exist but no discovery UI. Mirror the Team personas pattern: a curated registry, browse + one-click install.
- **Sketch**:
  - New constant `MCP_SERVERS_REPO` in `src/shared/mcp-config.ts` (mirror of `team-config.ts`).
  - GitHub Contents API browse with 1-hour cache (reuse pattern from `predefined-picker.ts`).
  - Each entry: `name`, `description`, `command`, `args`, `env`, `domain` for grouping.
  - Install path: write to user's MCP config (Claude/Codex/etc. — provider-aware).

### C13. Opt-in telemetry

- **Status**: [x] done 2026-05-07 (Umami self-hosted target)
- **Why**: Without any signal you're flying blind on which features get used. Anonymous, opt-in event counters would inform roadmap.
- **Decisions**:
  - Self-hosted Umami. Endpoint configured via `TELEMETRY_ENDPOINT` + `TELEMETRY_WEBSITE_ID` env vars at build time.
  - Events: `app.launch` (with available provider list + count), `session.start` (providerId + resume), `feature.used` with `kind: 'mount' | 'interaction'` discriminator across kanban/team/browser-tab/overview surfaces.
  - Preferences toggle next to the Sentry "Send crash reports" toggle in the Privacy subsection.
  - Anonymous device id (random UUID, persisted in `state.json`) + per-launch session id. Enables funnels without identifying users.
- **Outcome (2026-05-07)**:
  - New file `src/main/telemetry.ts` exports `initTelemetry`, `track`, `isTelemetryActive`. No-op unless: app is packaged + `telemetryEnabled === true` + both env vars set.
  - New `Preferences.telemetryEnabled?: boolean` and `PersistedState.telemetryDeviceId?: string` (lazy-generated UUID, no migration needed since both are optional).
  - `app.launch` fires from `main.ts` after Sentry init, payload `{ providersAvailable, providerCount }`. `session.start` fires from `pty-manager.ts` post-spawn, payload `{ providerId, resume }`.
  - New `telemetry:track` IPC channel in `ipc/app.ts` validates event names against the union and strips non-primitive data values + caps strings at 200 chars (defense-in-depth against renderer leaks).
  - Renderer helper `src/renderer/feature-telemetry.ts` provides `trackMount(surface)` (once per launch via in-memory Set) and `trackInteraction(surface, action)`. Wired at: kanban (`createBoardView` mount, `task-created` interaction), team (`renderTeam` mount, `member-created` / `member-edited` interactions), browser-tab (`createBrowserTabPane` mount, `navigate` interaction), overview (`createProjectTabPane` mount, `widget-added:<type>` interaction).
  - Preferences modal: new "Send anonymous usage stats (requires app restart)" toggle next to the Sentry one.
  - New `docs/PRIVACY.md` documents what's tracked, what's never tracked, opt-out path, and how to clear the device id.
  - 12 new tests in `telemetry.test.ts` cover all gating combinations + Umami payload shape + sessionId stability + idempotent init + swallowed network failures.
  - Test count: 1554 → 1566.
- **Follow-ups not done this session**:
  - **Provision the Umami instance + secrets** in CI (`TELEMETRY_ENDPOINT`, `TELEMETRY_WEBSITE_ID`). Until they're set, the toggle is a no-op even with the preference on.
  - **Runtime toggle without restart** — same constraint as Sentry (no clean shutdown for the per-launch sessionId / fetch loop).

### C17. Jira integration for kanban + project overview

- **Status**: [ ] feature backlog (added 2026-05-07)
- **Why**: User asked: "can I connect kanban board to Jira and show all jira tickets here, also whatever I add here should be sync to Jira?" Real workflows live in Jira; users still want a fast local kanban for tactical work. Closing the gap means AI-yard can be the daily driver instead of a parallel tool.
- **Recommendation**: Ship in three slices — read-only first, then linked actions, then (maybe) sync. Two-way sync is the obvious "user-facing" feature but creates an ongoing trust problem ("which side is right when they disagree?") that has burned many products. Defer it until we actually feel the pain.

#### Slice 1 — Jira widget (read-only mirror) — ~1–2 days

- **What**: A new `jira-issues` widget on the project overview tab, mirroring the existing `github-prs` / `github-issues` widget pattern (`src/renderer/components/project-tab/widgets/`). Shows Jira tickets matching a per-widget JQL filter; click-to-open in browser; unread tracking via `jira-unread.ts` (mirror of `github-unread.ts`).
- **Why first**: Smallest useful slice. Validates auth + REST plumbing for whatever sync comes later. Zero conflict-resolution surface.
- **Plan**:
  1. New `src/main/jira-api.ts` — minimal REST client (Atlassian REST API v3). Auth via API token + email (Jira Cloud) or PAT (Jira Server). Pattern mirrors `github-cli.ts` but uses `fetch` instead of shelling out (no Atlassian CLI is widely installed).
  2. Token storage: reuse the OS keychain via `safeStorage.encryptString()` from Electron — store under `state.jira.tokens[host]`, never plaintext.
  3. New IPC channels under `jira:*` namespace: `jira:listIssues({ host, jql, max })`, `jira:authenticate`, `jira:getIssue({ host, key })`. Add to the typed contract scaffolded in B6 once that lands.
  4. New widget factory `widgets/jira-issues-widget.ts` registered in `widget-registry.ts`. Settings modal: host URL, JQL, max items, refresh interval (mirror `github-settings-modal.ts`).
  5. Per-project default JQL stored on `ProjectRecord.jiraConfig` (host, default JQL, key prefix). First-time users prompted via the widget settings modal.
- **CSP impact**: Add the configured Jira host to `connect-src` in `src/renderer/index.html`. If hosts vary per user, switch to `connect-src https:` and document in A3 outcome.
- **Acceptance**: Widget renders Jira tickets, click opens browser, unread badge surfaces in tab bar via `hasUnreadInProject`.

#### Slice 2 — Linked actions (push, link, unlink) — ~1 day

- **What**: A "Push to Jira" action on local kanban cards (creates a ticket in the configured project, stores the returned key on the card as `card.jiraKey`). A small Jira chip on linked cards that opens the ticket. "Unlink" to break the association. No automatic sync.
- **Plan**:
  1. Extend `BoardCard` type in `src/shared/types.ts` with optional `jiraKey?: string`, `jiraHost?: string`.
  2. New IPC: `jira:createIssue({ host, projectKey, summary, description })`. Returns the issue key.
  3. Card context menu in `components/board/board-context-menu.ts` gains "Push to Jira" / "Open in Jira" / "Unlink Jira" entries (gated on whether `card.jiraKey` is set + whether project has Jira config).
  4. Card UI shows a small `JIRA-123` chip when linked (similar to the existing tag pill treatment).
- **Acceptance**: User right-clicks a local card → "Push to Jira" → ticket appears in Jira, chip appears on card, click chip opens Jira.

#### Slice 3 — Two-way sync (DEFER, decision needed) — ~1–2 weeks

- **What user asked for**: kanban moves → Jira status updates, and Jira status changes → kanban column updates.
- **Why defer**: Hard, and the trust cost compounds. Genuine difficulties:
  - **Schema mapping**: Jira workflows are arbitrary per-project; kanban columns aren't. Need a per-project mapping table (`jiraStatus → boardColumn`) maintained by the user.
  - **Field divergence**: Jira has assignees, sprints, components, custom fields, attachments, comments — kanban doesn't. Editing a Jira ticket in AI-yard either silently drops fields (bad) or refuses to edit them (worse UX).
  - **Conflict resolution**: User edits locally while a teammate updates Jira. Last-write-wins is wrong for status changes (silent loss). Three-way merge is heavy. No good answer.
  - **Polling vs webhooks**: Webhooks need a public endpoint (AI-yard is local) → polling, which means stale state until next poll. Conflict probability scales with poll interval.
  - **Archival semantics**: Jira tickets that get "Done + archived" vs local cards that get deleted. Not symmetric.
- **If we still ship it**: Start with **one-way push** (kanban → Jira only), expand to read-only pull on top (covered by slice 1 already), and only add **automatic Jira-state-into-kanban** behind a per-project opt-in flag with a "manual conflict prompt" UX. Never silently overwrite.
- **Decision needed from user**: confirm we ship slices 1 + 2 first and reassess sync after a few weeks of use. The 90% case is "see Jira tickets without leaving AI-yard" + "promote a local card to Jira when it's formal" — both delivered without the sync trap.

#### Cross-slice notes

- Atlassian MCP (`mcp__atlassian__*`) is great for **Claude Code conversations** but not the runtime app — those tools live in this CLI session, not in the packaged Electron app. The app needs its own REST client.
- Personal vs work Jira: like the GitHub `mikulgohil` / `mgohil-hztl` split documented in `~/.claude/rules/github.md`, design `state.jira.hosts` as a list keyed by host (`yourdomain.atlassian.net`, `work.atlassian.net`) so users can connect both.
- Test surface: `jira-api.test.ts` with `fetch` mocked, `jira-widget.test.ts` for render states (loading/empty/error/data), card-context-menu test for the "Push to Jira" action gating.

---

## Tier D — Reliability & safety nets

### D14. Sentry crash reporting

- **Status**: [x] done 2026-05-07 (main process only; renderer-side is a follow-up)
- **Why**: If renderer crashes on a user's edge case in `state.json`, you'll never know.
- **Plan**:
  1. `npm i @sentry/electron`.
  2. Init in `main.ts` (main process) and `index.ts` (renderer process). Read DSN from `process.env.SENTRY_DSN`.
  3. Add Preferences toggle "Send crash reports" — off by default.
  4. Strip PII from breadcrumbs (paths, file contents).
- **Acceptance**: Crash in main or renderer with toggle on → event shows up in Sentry. Toggle off → no network calls.
- **Outcome (2026-05-07)** — main process only:
  - Added `@sentry/electron@7.13.0` as a runtime dependency.
  - New file `src/main/sentry.ts` exports `initSentry(prefs)`. No-op unless: app is packaged + `crashReportsEnabled === true` + `process.env.SENTRY_DSN` is set. Never embeds a DSN in source.
  - Wired into `main.ts` immediately after `loadState()` so prefs drive the decision.
  - PII scrubbing: `beforeSend` and `beforeBreadcrumb` replace `~` for the home directory and `<state>` for `~/.ai-yard` in stack frames, exception messages, breadcrumb data, extra, and tags. Never sends usernames or absolute home paths.
  - New `Preferences.crashReportsEnabled?: boolean` field (optional, defaults to off).
  - Preferences modal: new "Privacy" subheading at the bottom of General with a "Send crash reports (requires app restart)" toggle. Reads/writes `appState.preferences.crashReportsEnabled`.
  - 5 new tests in `sentry.test.ts` covering: pref-off, pref-undefined, no-DSN, both-on (config validated), and `beforeSend` path scrubbing.
  - Renderer-side bundle unchanged (1.3 MB) — Sentry imported only from main.
  - Test count: 1526 → 1531.
- **Follow-ups not done this session**:
  - **Renderer-side Sentry** via `@sentry/electron/renderer`. Captures DOM/JS errors with proper stack traces in the Sentry UI. Adds bundle size cost (~50-80 KB minified). Worth doing once a DSN is provisioned.
  - **Runtime toggle without restart**. Sentry has no clean shutdown path for hooks; restart is the simplest correct behavior.
  - **CI build wiring**: pass `SENTRY_DSN` from a CI secret into the Electron build environment so packaged builds know where to ship reports. Until this lands, the toggle is a no-op even with the preference on.

### D15. Versioned state migrations

- **Status**: [x] done 2026-05-07
- **Why**: `state.ts:116` hardcodes `version: 1`. The next schema change with users on older versions will be painful. Cheap insurance.
- **Plan**:
  1. New file: `src/main/store/migrations.ts` exporting `runMigrations(state: any): PersistedState`.
  2. Each migration is `[fromVersion]: (state) => nextState` keyed by integer version.
  3. `loadState()` calls `runMigrations()` after JSON parse.
  4. Test: load a v1 fixture, expect v1 → vN result.
- **Acceptance**: Bumping `version: 2` plus a migrator works end-to-end and is tested.
- **Outcome (2026-05-07)**:
  - New file `src/main/store-migrations.ts` exports `CURRENT_VERSION` (1) and `runMigrations(rawState)`. Walks `state.version → CURRENT_VERSION`, applying registered migrators in order.
  - `loadState()` in `store.ts` now calls `runMigrations()` instead of the hard `parsed.version !== 1` rejection. Returns null cleanly if the chain is broken or the state is newer than this build (no silent downgrade).
  - `defaultState()` reads `version` from `CURRENT_VERSION` so bumping the constant in one place propagates correctly.
  - 5 new tests in `store-migrations.test.ts` cover pass-through, future-version refusal, missing-version refusal, gap-in-chain refusal, shape preservation.
  - **To bump to v2**: change `CURRENT_VERSION = 2`, add `migrations[1]: (state) => ({ ...state, /* shape changes */, version: 2 })`. The pattern is documented in the file's top comment.
  - Test count: 1521 → 1526.

### D16. Playwright Electron smoke test

- **Status**: [x] done 2026-05-07
- **Why**: 1526 unit tests is healthy but no end-to-end coverage. One golden-path test would catch regressions like "Worktree creation broken by WorktreeCreate observer hook" (CHANGELOG 0.2.32).
- **Plan**:
  1. `npm i -D @playwright/test`.
  2. New `tests/e2e/smoke.spec.ts`: launch app, see project list, create project (mocked path), open new session (mocked PTY), close.
  3. Wire into existing CI matrix (mac/linux/windows).
- **Acceptance**: `npm run test:e2e` passes locally; CI matrix runs it on every push.
- **Outcome (2026-05-07)**:
  - Added `@playwright/test@latest` as a devDep.
  - New file `playwright.config.ts` configured for Electron (1 worker, sequential, 60s timeout, GitHub reporter on CI).
  - New `tests/e2e/smoke.spec.ts` boots the packaged main process via `_electron.launch()`. Asserts window title is `AI-yard`, sidebar `+` button is visible, tab bar add-session button is visible.
  - **HOME redirected** to a fresh `mkdtemp` per run so the test never touches the user's `~/.ai-yard/`.
  - **AIYARD_E2E env var** added to `main.ts` to skip the "no CLI provider found" hard exit on machines without Claude/Codex/etc. installed (CI). Production behavior unchanged.
  - New `npm run test:e2e` script. Local run: 6.0s end-to-end (4.1s per test).
  - **CI wiring not done** — adding the matrix step is a 5-line edit to `.github/workflows/*.yml` once you confirm Playwright runs cleanly in your CI environment.

---

## Decision log

- **2026-05-07** — Doc created. Items A1, A2, A3 selected for this session. A4 awaits user decision. A5/B6–B9/C10–C13 deferred with design notes. D14/D15/D16 conditionally doable this session if user opts in.
- **2026-05-07** — User chose A1+A2+A3+A4 (path b)+D15. All five completed. 232 files lint-cleaned, bundle 1.9→1.3 MB, CSP tightened, auto-updater dormant, state migrations live. 1526 → 1531 tests.
- **2026-05-07** — User extended scope: D14 Sentry. Implemented main-process opt-in with PII scrubbing, Preferences toggle. Renderer-side Sentry left as a follow-up. 1531 tests.
- **2026-05-07** — User said "finish all". Honest constraint stated and accepted: A5/B6/B8/B9/C11 are unfinishable in one session without breakage. Delivered:
  - **D16** Playwright Electron smoke test — full implementation, 1 test passing in 4.1s.
  - **B7** ipc-handlers split — partial: `fs.ts`, `git.ts`, `github.ts` extracted. `ipc-handlers.ts` 660 → 354 lines.
  - **A5/B6/B8/B9** scaffolding only: `docs/MIGRATION_WEBVIEW.md` (5-phase plan), `src/shared/ipc-contract.ts` (typed contract starter), `src/main/store-sqlite-schema.sql` (full DDL), `electron-vite.config.draft.ts` (build pipeline draft).
  - **C10/C11/C12/C13** untouched — features need product/UI input before implementation.
- **2026-05-07** — Continuation session: shipped lint cleanup (#1), renderer-side Sentry (#2), Playwright CI wiring (#3), full IPC handler split (#4 finishing B7), and MCP marketplace UI (#6). 1554 tests.
- **2026-05-07** — Continuation session: shipped C13 telemetry (Umami opt-in) and C10 cost dashboard (new tab type, aggregator, view). Plus a Playwright e2e variant suite for the dashboard (populated / empty / light theme). 1554 → 1576 tests, 1 → 4 e2e tests.
- **2026-05-07** — Small follow-ups session: shipped MCP registry seed (`mcp-servers-seed/` with 4 validated entries + README). Surfaced (and deferred) the Sentry/telemetry env-var **embed gap** — `process.env.*` reads happen at user runtime, build pipeline never substitutes them, so adding GitHub secrets alone is a no-op even with the prefs toggled on. Documented the four-step fix in Open follow-ups above. No code changes to `src/`, no test/lint/build/e2e regressions (1576 / 1576 unit + 4 / 4 e2e).
- **2026-05-07** — Closing-the-loop session: shipped the Sentry/telemetry build-time codegen (commit `dd4e879`), closing the embed gap. `scripts/gen-build-config.js` bakes `SENTRY_DSN` / `TELEMETRY_ENDPOINT` / `TELEMETRY_WEBSITE_ID` into `src/main/build-config.ts` (gitignored) when CI provides them; runtime falls back to `process.env` for dev. `release.yml` passes all three env vars to the mac/linux/windows build jobs. Also published the MCP registry repo at https://github.com/mikulgohil/ai-yard-mcp-servers (public, 5 files, main branch); Contents API verified to return the 4 expected entries. Single bundled commit covered the prior-session pile too (rename + IPC split + cost dashboard + MCP UI + scaffolds for #9–#12) per user call. 1576 / 1576 unit + 4 / 4 e2e + lint + build clean.
- **2026-05-07** — Worktree-isolated multi-agent attempt for A5 + B8 + B9 hit two blockers: (a) harness creates worktrees from `origin/main` not local HEAD, so each new worktree was at `7f44076` (pre-rename) and missing all the scaffolding from `dd4e879`; (b) `mode: "bypassPermissions"` on spawned agents didn't override worktree-level Write/Edit denials. Pivot: execute serially in the parent repo. **B9 done in parent** — Vite (not electron-vite) for renderer HMR; `vite.renderer.config.ts` + `scripts/copy-vite-public.js` + HTML script-tag rewrite for legacy + `dev`/`dev:legacy` script split. Bundle 1.4 MB → 1.15 MB. Build clean, lint clean. Surfaced a pre-existing test regression (37 file failures in main-process tests, vitest+vite-7 resolver issue with bare `fs`/`path` imports — same with B9 reverted, so not a B9 effect). A5 + B8 still pending. Each agent's prior reconnaissance preserved as design notes in the next-session prompt.
- **2026-05-07** — A5 Phase 1 landed in the parent repo. New `src/renderer/components/browser-tab/view-adapter.ts` introduces the `ViewAdapter` interface and `createWebviewAdapter`. All `<webview>` call sites in `browser-tab/` rewritten to go through the adapter. Pure refactor; no behavior change. Test baseline preserved at 1077 / 37.
- **2026-05-07** — A5 Phase 2 landed in the parent repo. New `src/shared/browser-view-contract.ts` (channel + payload contract), `src/main/ipc/browser-view.ts` (main-process owner + handlers), `src/main/ipc/browser-view.test.ts` (15 tests). `preload.ts` adds `browserView` namespace; `view-adapter.ts` adds `createWebContentsViewAdapter`; `pane.ts` branches behind a `useWebContentsView` flag (default `false`). Build clean, lint clean. Tests **1077 → 1092 (+15)**, 37 file load failures unchanged. Phase 3 prompt drafted; ResizeObserver to live inside the adapter so `viewId` doesn't leak.
- **2026-05-07** — A5 Phase 3 landed in the parent repo. `createWebContentsViewAdapter` now owns a ResizeObserver on the placeholder + a `window.resize` listener, both feeding a rAF-debounced `flushBounds()` that pushes rounded CSS-pixel rects through `browser-view:setBounds`. Hidden panes (`offsetParent === null`) push `{0,0,0,0}` so the native view disappears without removeChildView churn. New `view-adapter.test.ts` (9 tests, no Node-builtin imports → loads cleanly past the resolver regression). Build clean, lint clean. Tests **1092 → 1101 (+9)**, 37 file load failures unchanged. `viewId` stayed inside the adapter as designed; Phase 4 (preload) and Phase 5 (cutover) still pending. Spot-checked with the flag flipped: build + lint pass and bundle goes 1,157.60 → 1,159.20 kB (the dead-code branch becoming live). Could not launch Electron interactively in this session, so the visual confirmation that the view actually renders at the placeholder's bounds remains for the next launch.
- **2026-05-07** — A5 Phase 4 landed in the parent repo. `src/preload/browser-tab-preload.ts` gained a `bubbleHostMessage(channel, payload)` helper that dual-emits `ipcRenderer.sendToHost` + `ipcRenderer.send`; replaced the three `sendToHost` call sites (`draw-stroke-end`, `element-selected`, `flow-element-picked`). The dual emit avoids runtime context detection — `sendToHost` outside `<webview>` is a silent no-op (its `ipc-message-host` channel has no receiver) and `send` under `<webview>` lands in main where no handler is registered for these channels, so each path picks up only its correct one. The seven inbound `ipcRenderer.on(...)` listeners (`enter-inspect-mode` etc.) need no change — `webContents.send` is generic and fires them identically on both adapters. `src/main/ipc/browser-view.ts` gained an `isAppAccelerator(input)` matcher mirroring `SHORTCUT_DEFAULTS`; the `before-input-event` listener now calls `event.preventDefault()` synchronously for matches, before broadcasting to renderer (the renderer's async `preventDefault` arrives too late to block the page). Skips universal text-editing combos (Cmd/Ctrl+S/Z/Y/C/V/X/A/R), bare keys, Alt-modified keys, and `keyUp` events. **Known gap**: user-customized keybindings aren't synced to main, so non-default shortcuts still fire our handler but the page also sees the keystroke — fix is ~60 LoC across contract + preload + main + renderer observer; deferred until a real user hits it. Build clean, lint clean. Tests **1101 → 1109 (+8)**, 37 file load failures unchanged. Bundle under default flag unchanged (1,157.60 kB); flag-flipped bundle still 1,159.20 kB (Phase 4 didn't touch the renderer dispatch shape). Could not launch Electron interactively, so end-to-end inspect/draw/flow IPC roundtrips against the live native view remain to be confirmed by the first user run after Phase 5.

## Final session status (2026-05-07)

**Completed (17 of 17 originally tracked):** Doc + A1 + A2 + A3 + A4 + A5 Phase 1 + A5 Phase 2 + B7 (full) + B9 (renderer HMR via plain Vite) + D14 (main + renderer) + D15 + D16 + #1 lint + #3 Playwright CI + #6 MCP marketplace UI + C10 cost dashboard + C13 telemetry

**In progress (1):** A5 (Phase 5 cutover pending — Phases 3 + 4 landed in subsequent sessions; see decision log entries above)

**Scaffolded for next session (2):** B6 (typed IPC bridge) + B8 (SQLite migration)

**Blocked:** C11 (CDP console capture) — depends on A5

**Pre-existing test regression (NOT caused by any item above)**: 37 main-process test files fail to load with vitest 4.1.x + vite 7.x ("Failed to resolve entry for package 'fs'"). 1077 tests in 83 files still pass. Affects bare Node-built-in imports — codebase uniformly uses bare `'fs'`/`'path'` (per CLAUDE.md note about 169 hits). Fix is independent of any feature work — codemod to `node:`-prefixed imports, or pin vitest to a version with the older resolver. Recommended: schedule as a standalone cleanup before B8 lands (B8 adds new tests that would also be subject to it).

**Open follow-ups (small):**

- ✅ **Telemetry / Sentry — embed gap closed 2026-05-07** (commit `dd4e879`):
  1. ✅ `scripts/gen-build-config.js` reads `SENTRY_DSN` / `TELEMETRY_ENDPOINT` / `TELEMETRY_WEBSITE_ID` at build time and emits `src/main/build-config.ts` (gitignored).
  2. ✅ `sentry.ts` / `telemetry.ts` now consume `getSentryDsn()` / `getTelemetryEndpoint()` / `getTelemetryWebsiteId()` from `./build-config`. Each getter returns the baked value when present, otherwise falls back to `process.env` at call time so dev launches still work and existing tests stay green.
  3. ✅ `release.yml` passes all three env vars to the mac, linux, and windows build jobs (alongside the existing `SENTRY_DSN`).
  4. ⏳ **Operational follow-up still pending** — provision Umami + Sentry projects, then run `gh secret set SENTRY_DSN`, `gh secret set TELEMETRY_ENDPOINT`, `gh secret set TELEMETRY_WEBSITE_ID` (or set them via the GitHub UI). Until those secrets exist, the codegen embeds `undefined` placeholders and runtime falls back to (also-unset) `process.env`, so both stay inert. The first release after the secrets land is the first one with active crash reporting + telemetry.

- ✅ **MCP marketplace registry — published 2026-05-07** at https://github.com/mikulgohil/ai-yard-mcp-servers (public, main branch, 5 files: `README.md` + 4 server JSON entries). Contents API verified — `GET /repos/mikulgohil/ai-yard-mcp-servers/contents/servers?ref=main` returns `fetch.json`, `filesystem.json`, `github.json`, `postgres.json`. The Browse modal will populate on next app launch.

**Final verification:**
- `npm run build` — clean (Vite renderer)
- `npm run build:legacy` — clean (esbuild fallback — for rollback)
- `npm test` — **1092 tests in 84 files pass; 37 files fail to load with the pre-existing vitest+vite resolver regression noted above. Net +15 from A5 Phase 2's `browser-view.test.ts`.**
- `npm run test:e2e` — not re-run this session (no e2e-relevant changes)
- `npm run lint` — clean
- Renderer bundle — **1.16 MB (Vite)** — A5 Phase 2 added ~1 KB (the WCV adapter is dormant; cost is only the dead-code branch)
- HMR — `npm run dev` (Vite + Electron + tsc watches) — script verified, manual HMR proof on first user `npm run dev`
