import type { BrowserViewEvent, ViewId, ViewRect } from '../../../shared/browser-view-contract.js';
import type { WebviewElement } from './types.js';

/**
 * Normalised key event surfaced through {@link ViewAdapter.onBeforeInput}.
 * Mirrors the shape Electron's `before-input-event` ships on the underlying
 * `<webview>`, but kept separate so consumers don't depend on Electron types.
 */
export interface BeforeInputEvent {
  type: string;
  key: string;
  shift: boolean;
  control: boolean;
  alt: boolean;
  meta: boolean;
}

/**
 * Subset of Electron's `NativeImage` we actually use today (data URL + PNG
 * bytes). Re-declaring locally keeps the renderer free of `electron` imports.
 */
export interface CapturedImage {
  toDataURL(): string;
  toPNG(): Uint8Array;
}

/**
 * Stable contract the rest of the browser-tab code uses to drive the embedded
 * web view. Phase 1 has a single implementation backed by `<webview>`. Phase 2
 * adds a `WebContentsView`-backed implementation that lives in the main
 * process, driven through IPC; nothing outside this file should need to change
 * when that lands.
 */
export interface ViewAdapter {
  getSrc(): string;
  setSrc(url: string): void;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;

  send(channel: string, ...args: unknown[]): void;
  capturePage(): Promise<CapturedImage>;

  setPreload(absolutePath: string): void;
  destroy(): void;

  /**
   * The DOM node that renders the view. Today this is the underlying
   * `<webview>`; Phase 2 will return a renderer-side placeholder element that
   * the main process positions a native `WebContentsView` on top of.
   */
  readonly element: HTMLElement;
  getBoundingClientRect(): DOMRect;
  setExplicitSize(width: number, height: number): void;
  clearExplicitSize(): void;

  onDidNavigate(cb: (url: string) => void): () => void;
  onDidNavigateInPage(cb: (url: string) => void): () => void;
  onIpcMessage(cb: (channel: string, args: unknown[]) => void): () => void;
  onBeforeInput(cb: (event: BeforeInputEvent, preventDefault: () => void) => void): () => void;
}

interface DidNavigateCustomEvent extends CustomEvent {
  url: string;
}

interface IpcMessageCustomEvent extends CustomEvent {
  channel: string;
  args: unknown[];
}

interface BeforeInputCustomEvent extends CustomEvent {
  preventDefault(): void;
  input: BeforeInputEvent;
}

export function createWebviewAdapter(webview: WebviewElement): ViewAdapter {
  const el = webview as unknown as HTMLElement;

  return {
    getSrc(): string {
      return webview.src;
    },
    setSrc(url: string): void {
      webview.src = url;
    },
    goBack(): void {
      webview.goBack();
    },
    goForward(): void {
      webview.goForward();
    },
    reload(): void {
      webview.reload();
    },
    stop(): void {
      webview.stop();
    },

    send(channel: string, ...args: unknown[]): void {
      webview.send(channel, ...args);
    },
    capturePage(): Promise<CapturedImage> {
      return webview.capturePage();
    },

    setPreload(absolutePath: string): void {
      el.setAttribute('preload', `file://${absolutePath}`);
    },
    destroy(): void {
      // The <webview> path doesn't need explicit teardown — pane.ts already
      // guards each cleanup call with try/catch, and removing the element
      // from the DOM tears down the underlying WebContents. Phase 2 will
      // wire this up to release the main-process WebContentsView handle.
    },

    get element(): HTMLElement {
      return el;
    },
    getBoundingClientRect(): DOMRect {
      return el.getBoundingClientRect();
    },
    setExplicitSize(width: number, height: number): void {
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      el.style.flex = 'none';
    },
    clearExplicitSize(): void {
      el.style.width = '';
      el.style.height = '';
      el.style.flex = '';
    },

    onDidNavigate(cb): () => void {
      const handler = ((e: DidNavigateCustomEvent) => cb(e.url)) as EventListener;
      el.addEventListener('did-navigate', handler);
      return () => el.removeEventListener('did-navigate', handler);
    },
    onDidNavigateInPage(cb): () => void {
      const handler = ((e: DidNavigateCustomEvent) => cb(e.url)) as EventListener;
      el.addEventListener('did-navigate-in-page', handler);
      return () => el.removeEventListener('did-navigate-in-page', handler);
    },
    onIpcMessage(cb): () => void {
      const handler = ((e: IpcMessageCustomEvent) => cb(e.channel, e.args)) as EventListener;
      el.addEventListener('ipc-message', handler);
      return () => el.removeEventListener('ipc-message', handler);
    },
    onBeforeInput(cb): () => void {
      const handler = ((e: BeforeInputCustomEvent) => cb(e.input, () => e.preventDefault())) as EventListener;
      el.addEventListener('before-input-event', handler);
      return () => el.removeEventListener('before-input-event', handler);
    },
  };
}

/**
 * Phase 2 adapter — backed by a main-process `WebContentsView`.
 *
 * The renderer holds a placeholder `<div>` that participates in DOM layout;
 * the native view will be positioned on top by Phase 3 (a ResizeObserver
 * watching the placeholder, forwarding bounds via `setBounds`). For now the
 * placeholder is created at zero size and the main-process view sits at
 * `{x:0,y:0,width:0,height:0}` until something drives setBounds.
 *
 * The adapter is created synchronously but the underlying viewId is only
 * known after the main-process create call resolves. Method calls made
 * before that resolution are queued and flushed on resolution; methods that
 * return data (capturePage) await the same promise.
 */
export interface CreateWebContentsViewAdapterInput {
  tabId: string;
  /**
   * Preload script path. Accepts a Promise so callers don't have to await
   * `getBrowserPreloadPath()` before constructing the adapter — the adapter
   * queues operations until both the path and the main-process create call
   * have resolved.
   */
  preloadPath: string | Promise<string>;
  url?: string;
}

export function createWebContentsViewAdapter(input: CreateWebContentsViewAdapterInput): ViewAdapter {
  const placeholder = document.createElement('div');
  placeholder.className = 'browser-webcontents-placeholder';
  placeholder.dataset.tabId = input.tabId;

  // Track the latest URL the main process reported so getSrc() stays cheap.
  let currentSrc = input.url ?? '';
  let destroyed = false;

  // Renderer-side subscriber lists — lets multiple consumers (pane.ts wires
  // four) share one main → renderer broadcast subscription per event kind.
  const navListeners = new Set<(url: string) => void>();
  const navInPageListeners = new Set<(url: string) => void>();
  const ipcListeners = new Set<(channel: string, args: unknown[]) => void>();
  const beforeInputListeners = new Set<(event: BeforeInputEvent, preventDefault: () => void) => void>();

  // The main-process `viewId` isn't known until create resolves. Queue any
  // method calls made before then; flush them once we have the id.
  const pendingOps: Array<(viewId: ViewId) => void> = [];
  let viewId: ViewId | null = null;
  let unsubscribe: (() => void) | null = null;

  // Phase 3: rAF-debounced positioning. The native WebContentsView lives in
  // the main process, so any DOM rearrangement that moves the placeholder has
  // to be mirrored via setBounds. We coalesce ResizeObserver bursts to one
  // setBounds call per animation frame; lastSentRect dedups identical pushes
  // (e.g. layout settled, observer fires once more with same dimensions).
  let rafToken: number | null = null;
  let lastSentRect: ViewRect | null = null;
  const ZERO_RECT: ViewRect = { x: 0, y: 0, width: 0, height: 0 };

  function computeRect(): ViewRect {
    // offsetParent === null catches `display: none` ancestors (used by the
    // .hidden modifier on .browser-tab-pane). The native view should disappear
    // in that case — pushing a zero rect is the cheapest way to do it without
    // tearing down the WebContentsView.
    if (placeholder.offsetParent === null) return ZERO_RECT;
    const r = placeholder.getBoundingClientRect();
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }

  function rectsEqual(a: ViewRect, b: ViewRect): boolean {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  }

  function flushBounds(): void {
    rafToken = null;
    if (destroyed) return;
    const rect = computeRect();
    if (lastSentRect !== null && rectsEqual(rect, lastSentRect)) return;
    lastSentRect = rect;
    applyOrQueue((id) => { void window.aiyard.browserView.setBounds(id, rect); });
  }

  function scheduleBoundsUpdate(): void {
    if (rafToken !== null || destroyed) return;
    rafToken = requestAnimationFrame(flushBounds);
  }

  // ResizeObserver covers: own size changes (split-layout drag), parent size
  // changes that flow into the flex child (window resize, sidebar resize),
  // and the show/hide path because flex children of `display:none` ancestors
  // get a zero contentRect entry. Note: ResizeObserver does NOT fire on pure
  // position changes (e.g. a sibling pane resizes pushing us right) — so we
  // also rely on the window-resize listener below.
  const resizeObserver = new ResizeObserver(scheduleBoundsUpdate);
  resizeObserver.observe(placeholder);

  // Window resize is what catches reposition-without-resize cases (the pane
  // element's content size doesn't change, but its viewport-relative origin
  // does). Cheap: scheduleBoundsUpdate is rAF-coalesced so multiple sources
  // collapse to one paint-aligned setBounds call.
  const onWindowResize = (): void => scheduleBoundsUpdate();
  window.addEventListener('resize', onWindowResize);

  function applyOrQueue(op: (viewId: ViewId) => void): void {
    if (viewId !== null) op(viewId);
    else pendingOps.push(op);
  }

  const ready = Promise.resolve(input.preloadPath).then((preloadPath) =>
    window.aiyard.browserView.create({
      tabId: input.tabId,
      preloadPath,
      url: input.url,
    }),
  ).then((res) => {
    if (destroyed) {
      // Created after the caller already destroyed us — clean up immediately.
      void window.aiyard.browserView.destroy(res.viewId);
      return;
    }
    viewId = res.viewId;
    unsubscribe = window.aiyard.browserView.onEvent(viewId, dispatchEvent);
    for (const op of pendingOps) op(viewId);
    pendingOps.length = 0;
    // Push initial bounds once we know the viewId. Without this the view
    // sits at {0,0,0,0} until something else triggers a layout change — a
    // newly-opened tab would render invisible until the user resized.
    scheduleBoundsUpdate();
  });

  function dispatchEvent(event: BrowserViewEvent): void {
    if (event.kind === 'did-navigate') {
      currentSrc = event.url;
      for (const cb of navListeners) cb(event.url);
    } else if (event.kind === 'did-navigate-in-page') {
      currentSrc = event.url;
      for (const cb of navInPageListeners) cb(event.url);
    } else if (event.kind === 'ipc-message') {
      for (const cb of ipcListeners) cb(event.channel, event.args);
    } else if (event.kind === 'before-input-event') {
      // Main-process side cannot know whether a renderer listener will call
      // preventDefault, so the renderer-side preventDefault is a no-op for
      // now. Phase 4 can revisit this if we need to suppress accelerator
      // key handling inside the view.
      const noopPreventDefault = (): void => {};
      for (const cb of beforeInputListeners) cb(event.input, noopPreventDefault);
    }
  }

  return {
    getSrc(): string {
      return currentSrc;
    },
    setSrc(url: string): void {
      currentSrc = url;
      applyOrQueue((id) => { void window.aiyard.browserView.navigate(id, url); });
    },
    goBack(): void {
      applyOrQueue((id) => { void window.aiyard.browserView.goBack(id); });
    },
    goForward(): void {
      applyOrQueue((id) => { void window.aiyard.browserView.goForward(id); });
    },
    reload(): void {
      applyOrQueue((id) => { void window.aiyard.browserView.reload(id); });
    },
    stop(): void {
      applyOrQueue((id) => { void window.aiyard.browserView.stop(id); });
    },

    send(channel: string, ...args: unknown[]): void {
      applyOrQueue((id) => { void window.aiyard.browserView.send(id, channel, args); });
    },

    async capturePage(): Promise<CapturedImage> {
      await ready;
      if (viewId === null) {
        // Adapter was destroyed before create resolved — return an empty image
        // shim so callers' `.toDataURL()` doesn't throw on shutdown paths.
        return { toDataURL: () => '', toPNG: () => new Uint8Array(0) };
      }
      const { dataUrl } = await window.aiyard.browserView.capturePage(viewId);
      return {
        toDataURL: () => dataUrl,
        // Lazy decode so we only do the work if the caller actually asks for
        // raw bytes. Most consumers only need the data URL.
        toPNG: () => decodeDataUrlToBytes(dataUrl),
      };
    },

    setPreload(absolutePath: string): void {
      // Electron only honors `webPreferences.preload` at WebContentsView
      // construction time, so this is informational once create has resolved.
      // Kept for ViewAdapter-interface parity with the legacy <webview> path.
      applyOrQueue((id) => { void window.aiyard.browserView.setPreload(id, absolutePath); });
    },

    destroy(): void {
      destroyed = true;
      // Stop tracking layout before tearing down IPC — a queued rAF that
      // fires after destroy would push a stale rect through applyOrQueue.
      if (rafToken !== null) {
        cancelAnimationFrame(rafToken);
        rafToken = null;
      }
      resizeObserver.disconnect();
      window.removeEventListener('resize', onWindowResize);
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      navListeners.clear();
      navInPageListeners.clear();
      ipcListeners.clear();
      beforeInputListeners.clear();
      if (viewId !== null) {
        const id = viewId;
        viewId = null;
        void window.aiyard.browserView.destroy(id);
      }
    },

    get element(): HTMLElement {
      return placeholder;
    },
    getBoundingClientRect(): DOMRect {
      return placeholder.getBoundingClientRect();
    },
    setExplicitSize(width: number, height: number): void {
      placeholder.style.width = `${width}px`;
      placeholder.style.height = `${height}px`;
      placeholder.style.flex = 'none';
    },
    clearExplicitSize(): void {
      placeholder.style.width = '';
      placeholder.style.height = '';
      placeholder.style.flex = '';
    },

    onDidNavigate(cb): () => void {
      navListeners.add(cb);
      return () => navListeners.delete(cb);
    },
    onDidNavigateInPage(cb): () => void {
      navInPageListeners.add(cb);
      return () => navInPageListeners.delete(cb);
    },
    onIpcMessage(cb): () => void {
      ipcListeners.add(cb);
      return () => ipcListeners.delete(cb);
    },
    onBeforeInput(cb): () => void {
      beforeInputListeners.add(cb);
      return () => beforeInputListeners.delete(cb);
    },
  };
}

function decodeDataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return new Uint8Array(0);
  const base64 = dataUrl.slice(comma + 1);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
