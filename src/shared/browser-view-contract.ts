/**
 * IPC contract for the WebContentsView-backed browser tab path (A5 Phase 2).
 *
 * Pure type-only module — no runtime imports — so both the main process
 * (`src/main/ipc/browser-view.ts`) and the renderer
 * (`src/renderer/components/browser-tab/view-adapter.ts`) can pin to the
 * same shape without dragging Electron types into the renderer bundle.
 *
 * Channel naming:
 *  - Renderer → main: `browser-view:<verb>` (handled with `ipcMain.handle`).
 *  - Main → renderer: a single broadcast channel `browser-view:event` with
 *    a discriminated `BrowserViewEvent` payload. One channel keeps the
 *    preload's `onEvent(viewId, cb)` subscription bookkeeping cheap.
 *
 * Status: dormant. Phase 2 ships these channels behind
 * `BrowserTabInstance.useWebContentsView` (default `false`). Phase 5 flips
 * the default and Phase 4 wires the preload-bridged events.
 */

/** Stable opaque identifier for a main-process WebContentsView. */
export type ViewId = string;

export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Mirrors the `BeforeInputEvent` shape already exposed from
 * `src/renderer/components/browser-tab/view-adapter.ts` so the renderer can
 * keep one definition. Re-declared inline here to avoid a circular import
 * across the renderer/shared boundary.
 */
export interface BrowserViewKeyEvent {
  type: string;
  key: string;
  shift: boolean;
  control: boolean;
  alt: boolean;
  meta: boolean;
}

// === Renderer → main channel payloads ===

export interface BrowserViewCreateInput {
  /** Stable id for the renderer-side BrowserTab instance (we reuse sessionId). */
  tabId: string;
  /** Initial URL. Optional — `about:blank` is loaded if omitted. */
  url?: string;
  /** Absolute file path of the preload to inject into the view's webContents. */
  preloadPath: string;
}

export interface BrowserViewCreateOutput {
  viewId: ViewId;
}

export interface BrowserViewIdInput {
  viewId: ViewId;
}

export interface BrowserViewSetBoundsInput {
  viewId: ViewId;
  rect: ViewRect;
}

export interface BrowserViewNavigateInput {
  viewId: ViewId;
  url: string;
}

export interface BrowserViewSendInput {
  viewId: ViewId;
  channel: string;
  args: unknown[];
}

export interface BrowserViewCapturePageOutput {
  /** PNG-encoded `data:image/png;base64,...` URL — NativeImage cannot cross IPC. */
  dataUrl: string;
}

// === Main → renderer broadcast events ===

export type BrowserViewEvent =
  | {
      kind: 'did-navigate';
      viewId: ViewId;
      url: string;
    }
  | {
      kind: 'did-navigate-in-page';
      viewId: ViewId;
      url: string;
    }
  | {
      kind: 'ipc-message';
      viewId: ViewId;
      channel: string;
      args: unknown[];
    }
  | {
      kind: 'before-input-event';
      viewId: ViewId;
      input: BrowserViewKeyEvent;
    };

/**
 * String table of every channel this contract owns. Use this constant rather
 * than typing literal channel names so the call sites stay greppable and
 * typo-proof.
 */
export const BROWSER_VIEW_CHANNELS = {
  create: 'browser-view:create',
  destroy: 'browser-view:destroy',
  setBounds: 'browser-view:setBounds',
  navigate: 'browser-view:navigate',
  goBack: 'browser-view:goBack',
  goForward: 'browser-view:goForward',
  reload: 'browser-view:reload',
  stop: 'browser-view:stop',
  send: 'browser-view:send',
  capturePage: 'browser-view:capturePage',
  setPreload: 'browser-view:setPreload',
  /** Single broadcast channel — renderer filters by `viewId`. */
  event: 'browser-view:event',
} as const;

export type BrowserViewChannel = (typeof BROWSER_VIEW_CHANNELS)[keyof typeof BROWSER_VIEW_CHANNELS];
