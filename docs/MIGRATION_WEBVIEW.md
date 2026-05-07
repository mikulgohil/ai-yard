# Webview → WebContentsView migration plan (A5)

> **Status**: Plan only. Not started. The current browser-tab implementation uses
> `<webview>` (deprecated by Electron). This document is the next session's
> starting point.

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

## Recommended approach: feature flag per tab

Rather than big-bang rewriting all browser-tab code, introduce a `useWebContentsView`
flag at the `instance` level. Build the new path side-by-side, ship behind the flag,
then flip default once equivalence is proven.

```ts
// src/renderer/components/browser-tab/types.ts
export interface BrowserTabInstance {
  // ... existing fields ...
  /** Whether this instance uses the new WebContentsView-backed path. */
  useWebContentsView: boolean;
}
```

## Step-by-step plan

### Phase 1 — Adapter interface (1-2 hours)

Create an interface that abstracts what the rest of the code calls today:

```ts
// src/renderer/components/browser-tab/view-adapter.ts
export interface BrowserTabViewAdapter {
  navigate(url: string): void;
  reload(): void;
  goBack(): void;
  goForward(): void;
  send(channel: string, ...args: unknown[]): void;
  capturePage(): Promise<Electron.NativeImage>;
  setBounds(rect: { x: number; y: number; width: number; height: number }): void;
  on(event: 'did-navigate', cb: (url: string) => void): () => void;
  on(event: 'ipc-message', cb: (channel: string, args: unknown[]) => void): () => void;
  destroy(): void;
}

// Implementation #1: existing <webview> path
export function createWebviewAdapter(/* existing webview element */): BrowserTabViewAdapter;

// Implementation #2: new WebContentsView path
export function createWebContentsViewAdapter(/* main-process IPC handle */): BrowserTabViewAdapter;
```

Refactor existing code to talk through the adapter (no behavior change). This is
the largest single chunk of mechanical work.

### Phase 2 — WebContentsView IPC channels (2-4 hours)

Add IPC channels to spawn/manage views from the renderer:

- `browser-view:create` (input: tabId, url, preload-path) → returns viewId
- `browser-view:destroy` (input: viewId)
- `browser-view:setBounds` (input: viewId, rect)
- `browser-view:navigate` (input: viewId, url)
- `browser-view:send` (input: viewId, channel, args) — forwards to view's webContents
- `browser-view:on` — broadcasts `did-navigate`, `ipc-message` from view's webContents

Implement these in `src/main/ipc/browser-view.ts`. The main process owns a
`Map<viewId, WebContentsView>`.

### Phase 3 — Repositioning (1-2 hours)

`<webview>` follows DOM layout automatically. `WebContentsView` does not — you
must call `setBounds()` whenever the surrounding DOM rearranges.

Options:
- **ResizeObserver** on the view's container element, debounced. Forwards new
  geometry via `browser-view:setBounds`.
- Tab switching: hide via `setBounds({ width: 0, height: 0 })` or remove from
  parent window's `contentView`.

### Phase 4 — Preload migration (1-2 hours)

The current preload at `src/preload/browser-tab-preload.ts` runs **inside** each
webview. With `WebContentsView`, set it via:

```ts
view.webContents.session.setPreloads([browserTabPreloadPath]);
```

The preload script itself probably needs minor tweaks (the `webContents` object
exposed to it differs slightly from the webview-scoped one).

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
