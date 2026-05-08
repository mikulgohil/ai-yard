# Webview → WebContentsView migration plan (A5)

> **Status**: Phases 1, 2, 3, 4 done (2026-05-07). Phase 5 (cutover) pending.
> The new `WebContentsView`-backed path exists in main + renderer + preload
> behind the `BrowserTabInstance.useWebContentsView` flag (default `false`),
> so the legacy `<webview>` path still owns every browser tab today.

## Why migrate

`<webview>` is officially "discouraged, will eventually be removed" in the
Electron docs. `WebContentsView` (Electron 30+) is the supported replacement.
Benefits:

- Better process isolation — each `WebContentsView` is its own separate `WebContents`.
- Cleaner crash recovery (kill one tab without affecting the host window).
- Native integration with `BrowserView`-era APIs (positioning, z-order).

## Why this is a multi-day effort

`<webview>` is a DOM element that lives **inside the renderer**. The host app
talks to it via `webview.send()`, `webview.executeJavaScript()`, etc., all from
renderer code.

`WebContentsView` lives **inside the main process**. The host app must:

1. Create the view in main and `setBounds()` to position it.
2. Re-implement the inspect/draw/flow IPC: renderer asks main → main asks
   the view's `webContents` → view's preload bubbles back to main → main forwards
   to renderer.
3. Replace renderer-side `<webview>` event listeners with main-process
   `webContents.on('did-navigate', ...)` and IPC.
4. Move the preload script from a `webview` attribute to
   `view.webContents.session.setPreloads()` or `session.on('preload-error')`.

Affected files (~30 call sites):
- `src/renderer/components/browser-tab/pane.ts` — element creation, event wiring
- `src/renderer/components/browser-tab/draw-mode.ts` — `webview.send`, `capturePage`
- `src/renderer/components/browser-tab/inspect-mode.ts` — `webview.send`
- `src/renderer/components/browser-tab/flow-recording.ts` — `webview.send`
- `src/renderer/components/browser-tab/flow-picker.ts` — geometry
- `src/renderer/components/browser-tab/popover.ts` — geometry
- `src/renderer/components/browser-tab/navigation.ts` — `webview.src`
- `src/preload/browser-tab-preload.ts` — moves from webview-scoped to main-injected

## Approach: feature flag per tab (in place since Phase 2)

`BrowserTabInstance.useWebContentsView` is the per-tab flag. Default `false`.
Phase 5 flips the default; until then every tab still runs the legacy
`<webview>` path. The branch lives in `pane.ts`:

```ts
const useWebContentsView = false; // Phase 5 will flip this default
const view: ViewAdapter = useWebContentsView
  ? createWebContentsViewAdapter({ tabId: sessionId, preloadPath: getPreloadPath(), url })
  : (() => {
      const webview = document.createElement('webview') as unknown as WebviewElement;
      // ... attribute setup ...
      return createWebviewAdapter(webview);
    })();
```

## Step-by-step plan

### Phase 1 — Adapter interface (DONE 2026-05-07)

Created `src/renderer/components/browser-tab/view-adapter.ts` with the
`ViewAdapter` interface and `createWebviewAdapter`. The interface
intentionally hides Electron types (e.g. `BeforeInputEvent`, `CapturedImage`
are re-declared locally) so the renderer stays free of `electron` imports.

All ~30 `<webview>` call sites in `browser-tab/*.ts` now go through the
adapter. Pure refactor; no behavior change. This was the largest single
chunk of mechanical work in the migration and is the foundation Phase 2
builds on.

Methods exposed: `getSrc` / `setSrc` / `goBack` / `goForward` / `reload` /
`stop` / `send` / `capturePage` / `setPreload` / `destroy` /
`getBoundingClientRect` / `setExplicitSize` / `clearExplicitSize` /
`onDidNavigate` / `onDidNavigateInPage` / `onIpcMessage` / `onBeforeInput`,
plus an `element` getter that returns the underlying DOM node.

### Phase 2 — WebContentsView IPC channels (DONE 2026-05-07)

Built the main-process WebContentsView path side-by-side with `<webview>`,
behind `BrowserTabInstance.useWebContentsView` (default `false`).

**Files added:**
- `src/shared/browser-view-contract.ts` — type-only module exporting
  `BROWSER_VIEW_CHANNELS` (single source of truth for channel names) plus
  `BrowserViewCreateInput` / `BrowserViewEvent` / `BrowserViewKeyEvent` /
  `ViewRect` / `ViewId` types. Both main and renderer pin against this so
  Electron types never leak across the boundary.
- `src/main/ipc/browser-view.ts` (~200 LoC) — owns
  `Map<viewId, {view, window, cleanups}>`. Registers `browser-view:*`
  handlers via `registerBrowserViewIpcHandlers()` from `ipc-handlers.ts`.
  Wires `webContents.on(...)` listeners inside `create` and releases them
  in `destroy`. Broadcasts events on a single channel `browser-view:event`
  with a discriminated `BrowserViewEvent` payload — renderer filters by
  `viewId`. Includes `_resetForTesting` / `_peekForTesting` hooks.
- `src/main/ipc/browser-view.test.ts` — 15 tests. Mocks the entire
  `electron` module with `vi.fn(function() {...})` (NOT arrow) so
  `new WebContentsView()` is constructable under the mock. Covers contract
  coverage, full create/destroy lifecycle, every method handler, broadcast
  event payload shape (including the `before-input-event` Electron.Input →
  `BrowserViewKeyEvent` flattening), and unknown-`viewId` preconditions.

**Files modified:**
- `src/main/ipc-handlers.ts` — registers the new module.
- `src/preload/preload.ts` — adds `aiyard.browserView` namespace with 11
  invoke wrappers and an `onEvent(viewId, cb)` filtered subscriber.
- `src/renderer/types.ts` — mirrors the `browserView` namespace types.
- `src/renderer/components/browser-tab/view-adapter.ts` — adds
  `createWebContentsViewAdapter`. Accepts `preloadPath: string | Promise<string>`
  so callers don't need to await `getBrowserPreloadPath()` first; the
  adapter queues every method invocation until both the path and the
  main-process create call resolve. `capturePage()` returns a
  `{ toDataURL, toPNG }` shim because NativeImage cannot cross IPC
  (PNG bytes are decoded lazily from the data URL).
- `src/renderer/components/browser-tab/types.ts` — adds
  `useWebContentsView: boolean` to `BrowserTabInstance`.
- `src/renderer/components/browser-tab/pane.ts` — branches between the
  two adapter factories behind `const useWebContentsView = false`.
- `src/renderer/styles/browser-tab.css` — `.browser-webcontents-placeholder`
  rules mirroring `.browser-webview` so the placeholder participates in
  flex layout (Phase 3 reads its `getBoundingClientRect` for `setBounds`).

**Channel inventory** (renderer → main, all `ipcMain.handle`):
`browser-view:create` → `{ viewId }`, `browser-view:destroy`,
`browser-view:setBounds`, `browser-view:navigate`, `browser-view:goBack`,
`browser-view:goForward`, `browser-view:reload`, `browser-view:stop`,
`browser-view:send`, `browser-view:capturePage` → `{ dataUrl }`,
`browser-view:setPreload` (no-op — Electron only honors `webPreferences.preload`
at WebContentsView construction; kept on the wire for ViewAdapter parity).

Main → renderer broadcast on `browser-view:event` with discriminated
`BrowserViewEvent`: `did-navigate` | `did-navigate-in-page` | `ipc-message`
| `before-input-event`.

**Surprises worth knowing for Phase 4:**
- Electron 35+ deprecated `webContents.goBack()` / `goForward()` in favor
  of `webContents.navigationHistory.goBack()`. Handler tries the new path
  first, falls back to legacy.
- `webContents.on('ipc-message', (event, channel, ...args))` uses rest-args,
  not a single `args` array. The handler bundles them so the renderer side
  reads them identically to `<webview>`'s `IpcMessageCustomEvent.args`.
- `webContents.on('before-input-event', (event, input))` ships
  `Electron.Input` (many fields). Handler strips to the same six-field
  shape `BeforeInputEvent` already exposed in `view-adapter.ts`.
  Renderer-side `preventDefault()` becomes a **no-op** in the WCV path —
  the main-process listener cannot synchronously wait for the renderer.
  Phase 4 should re-verify global keybindings still suppress correctly.

**Tests:** 1077 → 1092 (+15). 37 file load failures unchanged (pre-existing
vitest+vite-7 resolver regression).

### Phase 3 — Repositioning (DONE 2026-05-07)

`<webview>` follows DOM layout automatically. `WebContentsView` does not — you
must call `setBounds()` whenever the surrounding DOM rearranges.

**What landed:**
- ResizeObserver + `window.resize` listener live **inside**
  `createWebContentsViewAdapter`. The `viewId` does not leak to `pane.ts`.
- rAF-debounced `flushBounds()` — one pending `requestAnimationFrame` token
  at a time. ResizeObserver bursts during a window-resize drag collapse to
  one `setBounds` call per frame.
- `lastSentRect` dedup — when the observer fires with unchanged geometry
  (common after layout settles) the IPC push is elided.
- Visibility transitions handled via `placeholder.offsetParent === null`
  inside `computeRect()`. When the parent `.browser-tab-pane` gets
  `display: none` (the `.hidden` modifier set by `hideAllBrowserTabPanes`),
  the rect collapses to `{0,0,0,0}` and the native view disappears without
  removeChildView/addChildView churn.
- Initial bounds are pushed once when `create` resolves so a newly-opened
  tab doesn't sit at zero size waiting for a resize.
- Coordinate space: CSS pixels (rounded with `Math.round`). Matches
  Electron's `setBounds` on macOS / Windows. Linux may need device-pixel
  scaling — a TODO worth checking once we test there.
- Window resize is wired in addition to ResizeObserver because RO fires only
  on size changes — pure position changes (e.g. a sibling pane resizing
  pushes us right without resizing us) don't trigger it.
- Cleanup: `destroy()` cancels any pending rAF, disconnects the observer,
  removes the window listener, then proceeds to the existing IPC teardown.

**Tests (`view-adapter.test.ts`)**: 9 tests covering rounded initial bounds,
debouncing (5 fires → 1 setBounds), hidden→zero rect, redundant-rect dedup,
viewId-not-yet-resolved queueing, window-resize trigger, destroy disconnects
observer, destroy cancels pending rAF, and onEvent → did-navigate dispatch.

**Bundle impact under default flag**: zero (the WCV branch is dead code).
With the flag flipped to `true` for spot-check the renderer bundle goes from
1,157.60 kB → 1,159.20 kB (the live branch pulls the rAF + observer wiring
into the chunk).

Phase 4 inherits a fully-positioned native view ready for IPC roundtrip
testing.

### Phase 4 — Preload migration (DONE 2026-05-07)

Phase 2 already wires the preload via `webPreferences.preload` at
`WebContentsView` construction time (see `src/main/ipc/browser-view.ts` —
the `create` handler). Electron only honors the preload at construction,
which is why `browser-view:setPreload` is a no-op on the wire today.

**What landed:**

1. **Dual-emit bubble in `browser-tab-preload.ts`** — the three guest →
   host call sites (`draw-stroke-end`, `element-selected`,
   `flow-element-picked`) now go through a `bubbleHostMessage(channel,
   payload)` helper that fires both `ipcRenderer.sendToHost` and
   `ipcRenderer.send`. This avoids runtime context detection: under
   `<webview>` the host renderer's `ipc-message` DOM event picks up
   `sendToHost` and `send` is a dead channel in main; under
   `WebContentsView` the reverse — `webContents.on('ipc-message', ...)`
   in `src/main/ipc/browser-view.ts` catches `send` and rebroadcasts as
   a `BrowserViewEvent { kind: 'ipc-message' }` for the renderer's
   `createWebContentsViewAdapter` to dispatch. `sendToHost` is a silent
   no-op outside `<webview>` (its internal `ipc-message-host` channel
   has no receiver), so the dual emit is safe in both directions.
2. **Inbound `webContents.send` → `ipcRenderer.on` works unchanged** —
   the seven listeners in `browser-tab-preload.ts:296-308`
   (`enter-inspect-mode`, `exit-inspect-mode`, `enter-flow-mode`,
   `exit-flow-mode`, `enter-draw-mode`, `exit-draw-mode`, `draw-clear`,
   `flow-do-click`) require no code change. The renderer's
   `view.send(channel, ...args)` routes through
   `browser-view:send` → `webContents.send(channel, ...args)`, which is
   a generic Electron IPC path that fires `ipcRenderer.on(channel, ...)`
   on every webContents — `<webview>` and `WebContentsView` alike.
3. **Main-side keybinding suppression** — `src/main/ipc/browser-view.ts`
   now calls `event.preventDefault()` synchronously inside
   `before-input-event` for keystrokes that match our app accelerators.
   The renderer's `preventDefault` callback on the broadcast event is
   too late to block the page handler — by the time it arrives, the
   in-page handler has already run. The `isAppAccelerator(input)`
   matcher mirrors the static accelerators in
   `src/renderer/shortcuts.ts:SHORTCUT_DEFAULTS` and explicitly skips
   universal text-editing combos (Cmd/Ctrl+S/Z/Y/C/V/X/A/R) so embedded
   pages keep their save/undo/copy behavior. Bare keystrokes,
   Alt-modified keystrokes, and `keyUp` events are all left to the page
   intentionally.

**Known limitation — user-customized keybindings**: the `isAppAccelerator`
matcher hardcodes the static defaults, so a non-default accelerator
(`Preferences.keybindings`) still fires our shortcut handler via the
broadcast → matchEvent path in the renderer, but the page also sees the
keystroke. Fixing this requires syncing the active accelerator list from
renderer to main on every preference change (~60 LoC across the contract
+ preload + main + renderer-side observer). Deferred to Phase 5 or a
follow-up if real users hit it.

**Tests (`src/main/ipc/browser-view.test.ts`)**: 1101 → 1109 (+8). Eight
new tests in an `isAppAccelerator` describe block plus an updated
`before-input-event` test that asserts both the suppress-and-broadcast
path (Cmd+W) and the don't-suppress path (Cmd+A → page select-all
preserved).

**Bundle impact under default flag**: zero (the WCV branch is dead code).
With the flag flipped to `true` for spot-check the renderer bundle goes
from 1,157.60 kB → 1,159.20 kB — same delta as Phase 3, since Phase 4
landed only in the preload + main and the renderer's adapter dispatch
shape was unchanged.

**Manual smoke test not run**: launching Electron interactively from this
session was not possible, so the visual confirmation that
inspect/draw/flow IPC roundtrips work end-to-end against the live native
view is deferred to the first user run. Build + lint + unit-test
coverage of the preload helper, the main-side accelerator matcher, and
the existing IPC bubbling is the necessary-but-not-sufficient fallback.

### Phase 5 — Cutover (1-2 hours)

- Default `useWebContentsView` to true for new tabs.
- Run existing browser-tab tests against both paths.
- Once parity confirmed, delete the `<webview>` adapter and remove `webviewTag: true`
  from `BrowserWindow` config.

## Acceptance criteria

- All current browser-tab features work: navigation, back/forward, reload,
  inspect mode, draw mode, flow recording, screenshot capture, file drop.
- `webviewTag: false` in `src/main/main.ts`.
- Zero `<webview>` references in renderer source.
- Existing browser-tab tests pass without modification (because of the adapter).
- New e2e test in `tests/e2e/` covers a navigate → inspect → "Ask AI" round-trip.

## Pitfalls to avoid

- **Don't** skip the adapter and rewrite call sites directly. The temptation is
  high but the bug surface is enormous. Adapter first, migration second.
- **Don't** assume `WebContentsView` event names match `<webview>` event names.
  Check the docs for each one as you migrate.
- **Don't** position the view by reading geometry once. The DOM moves; bounds
  must update reactively.
- **Don't** delete `webviewTag: true` until the last `<webview>` reference is gone.
  Premature removal will throw at runtime.

## Estimated total: 7-12 hours of focused work
