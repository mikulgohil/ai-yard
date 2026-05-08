import { BrowserWindow, ipcMain, WebContentsView } from 'electron';
import {
  BROWSER_VIEW_CHANNELS,
  type BrowserViewCapturePageOutput,
  type BrowserViewCreateInput,
  type BrowserViewCreateOutput,
  type BrowserViewEvent,
  type BrowserViewIdInput,
  type BrowserViewKeyEvent,
  type BrowserViewNavigateInput,
  type BrowserViewSendInput,
  type BrowserViewSetBoundsInput,
  type ViewId,
} from '../../shared/browser-view-contract';

/**
 * Main-process owner for the WebContentsView-backed browser tab path
 * (A5 Phase 2). See `docs/MIGRATION_WEBVIEW.md` and the contract in
 * `src/shared/browser-view-contract.ts`.
 *
 * Dormant by default — the renderer only reaches these handlers when a
 * `BrowserTabInstance` is constructed with `useWebContentsView: true`.
 * Phase 5 flips the default; Phase 3 will start positioning the views via
 * `setBounds` driven from a renderer-side ResizeObserver.
 */

interface ManagedView {
  view: WebContentsView;
  window: BrowserWindow;
  /** Listener cleanups registered when the view was created. */
  cleanups: Array<() => void>;
}

const views = new Map<ViewId, ManagedView>();
let viewCounter = 0;

function nextViewId(): ViewId {
  viewCounter += 1;
  return `bv-${Date.now().toString(36)}-${viewCounter}`;
}

/** Broadcast a single event to every renderer window. The renderer filters by `viewId`. */
function broadcast(event: BrowserViewEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(BROWSER_VIEW_CHANNELS.event, event);
  }
}

/**
 * Phase 4: in-page keystroke suppression for app accelerators.
 *
 * Under the legacy `<webview>` adapter, the renderer-side `onBeforeInput`
 * handler called `event.preventDefault()` synchronously to stop the page
 * from also handling the keystroke. Under `WebContentsView` the bridge
 * is async (main → renderer broadcast cannot synchronously block the
 * page), so suppression must happen here in main inside the
 * `before-input-event` listener — *before* it returns.
 *
 * The set below mirrors the static accelerators in
 * `src/renderer/shortcuts.ts:SHORTCUT_DEFAULTS`. We deliberately do NOT
 * suppress the universal text-editing combos (Cmd/Ctrl+S, +Z, +Y, +C,
 * +V, +X, +A, +R, etc.) so embedded pages keep their save/undo/copy
 * behavior.
 *
 * Known gap: user-customized keybindings (`Preferences.keybindings`) are
 * not synced into main, so a non-default shortcut still fires our handler
 * via the broadcast → matchEvent path but the page also sees the
 * keystroke. Documented in `docs/MIGRATION_WEBVIEW.md` Phase 4.
 */
const APP_ACCELERATOR_KEYS_PLAIN: ReadonlySet<string> = new Set([
  't', 'w', 'b', 'j', 'p', 'f', 'l',
  '\\',
  '=', '-', '0',
  '1', '2', '3', '4', '5', '6', '7', '8', '9',
  ']', '[',
]);
const APP_ACCELERATOR_KEYS_SHIFT: ReadonlySet<string> = new Set([
  'n', 'p', 'd', 'g', 'u', 'i', 'f',
  ']', '[',
]);

function isAppAccelerator(input: Electron.Input): boolean {
  if (input.type !== 'keyDown') return false;
  // Bare keystrokes belong to the page.
  if (!input.control && !input.meta) return false;
  // No current shortcut uses Alt; let pages keep Alt-modified keys.
  if (input.alt) return false;
  const key = input.key.toLowerCase();
  if (input.shift) return APP_ACCELERATOR_KEYS_SHIFT.has(key);
  return APP_ACCELERATOR_KEYS_PLAIN.has(key);
}

/** Test-only export so the unit test can assert the matcher's contract. */
export const _isAppAcceleratorForTesting = isAppAccelerator;

/**
 * Wire up the webContents listeners that bubble back to the renderer. The
 * returned array of cleanups is stored on the `ManagedView` so destroy()
 * can release them deterministically.
 */
function attachListeners(viewId: ViewId, view: WebContentsView): Array<() => void> {
  const wc = view.webContents;
  const cleanups: Array<() => void> = [];

  const onDidNavigate = (_event: Electron.Event, url: string): void => {
    broadcast({ kind: 'did-navigate', viewId, url });
  };
  wc.on('did-navigate', onDidNavigate);
  cleanups.push(() => wc.off('did-navigate', onDidNavigate));

  const onDidNavigateInPage = (_event: Electron.Event, url: string): void => {
    broadcast({ kind: 'did-navigate-in-page', viewId, url });
  };
  wc.on('did-navigate-in-page', onDidNavigateInPage);
  cleanups.push(() => wc.off('did-navigate-in-page', onDidNavigateInPage));

  const onIpcMessage = (_event: Electron.Event, channel: string, ...args: unknown[]): void => {
    broadcast({ kind: 'ipc-message', viewId, channel, args });
  };
  wc.on('ipc-message', onIpcMessage);
  cleanups.push(() => wc.off('ipc-message', onIpcMessage));

  const onBeforeInput = (event: Electron.Event, input: Electron.Input): void => {
    // Synchronous suppression — the renderer-side `preventDefault` on the
    // broadcast event is too late to stop the page from handling the same
    // keystroke. See the comment on `isAppAccelerator` above.
    if (isAppAccelerator(input)) {
      event.preventDefault();
    }
    const payload: BrowserViewKeyEvent = {
      type: input.type,
      key: input.key,
      shift: input.shift,
      control: input.control,
      alt: input.alt,
      meta: input.meta,
    };
    broadcast({ kind: 'before-input-event', viewId, input: payload });
  };
  wc.on('before-input-event', onBeforeInput);
  cleanups.push(() => wc.off('before-input-event', onBeforeInput));

  return cleanups;
}

function getOwnerWindow(): BrowserWindow | null {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  return win ?? null;
}

function requireView(viewId: ViewId): ManagedView {
  const managed = views.get(viewId);
  if (!managed) throw new Error(`browser-view: no view registered for id ${viewId}`);
  return managed;
}

/** Test-only hook so unit tests can inspect or reset module state. */
export function _resetForTesting(): void {
  for (const managed of views.values()) {
    for (const cleanup of managed.cleanups) cleanup();
    try {
      managed.view.webContents.close();
    } catch {
      // Best-effort — the test mock may not implement close().
    }
  }
  views.clear();
  viewCounter = 0;
}

/** Test-only hook so unit tests can inspect the active map. */
export function _peekForTesting(viewId: ViewId): ManagedView | undefined {
  return views.get(viewId);
}

export function registerBrowserViewIpcHandlers(): void {
  ipcMain.handle(BROWSER_VIEW_CHANNELS.create, (_event, input: BrowserViewCreateInput): BrowserViewCreateOutput => {
    const window = getOwnerWindow();
    if (!window) throw new Error('browser-view:create called with no host BrowserWindow');

    const view = new WebContentsView({
      webPreferences: {
        preload: input.preloadPath,
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
      },
    });

    const viewId = nextViewId();
    const cleanups = attachListeners(viewId, view);

    // Park the view at zero size — Phase 3 will drive setBounds from the
    // renderer's ResizeObserver. We still attach it to the window's content
    // view so its lifecycle is bound to the window.
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    window.contentView.addChildView(view);

    void view.webContents.loadURL(input.url ?? 'about:blank');

    views.set(viewId, { view, window, cleanups });
    return { viewId };
  });

  ipcMain.handle(BROWSER_VIEW_CHANNELS.destroy, (_event, input: BrowserViewIdInput): void => {
    const managed = views.get(input.viewId);
    if (!managed) return;
    for (const cleanup of managed.cleanups) cleanup();
    try {
      managed.window.contentView.removeChildView(managed.view);
    } catch {
      // Window may already be torn down — ignore.
    }
    try {
      managed.view.webContents.close();
    } catch {
      // Best-effort.
    }
    views.delete(input.viewId);
  });

  ipcMain.handle(BROWSER_VIEW_CHANNELS.setBounds, (_event, input: BrowserViewSetBoundsInput): void => {
    const managed = requireView(input.viewId);
    managed.view.setBounds(input.rect);
  });

  ipcMain.handle(BROWSER_VIEW_CHANNELS.navigate, (_event, input: BrowserViewNavigateInput): void => {
    const managed = requireView(input.viewId);
    void managed.view.webContents.loadURL(input.url);
  });

  ipcMain.handle(BROWSER_VIEW_CHANNELS.goBack, (_event, input: BrowserViewIdInput): void => {
    const wc = requireView(input.viewId).view.webContents;
    // Electron 35+ exposes navigationHistory.goBack(); fall back to the older
    // top-level wc.goBack() so we cover the version range without compile errors.
    if (wc.navigationHistory && typeof wc.navigationHistory.goBack === 'function') {
      wc.navigationHistory.goBack();
    } else if (typeof (wc as unknown as { goBack?: () => void }).goBack === 'function') {
      (wc as unknown as { goBack: () => void }).goBack();
    }
  });

  ipcMain.handle(BROWSER_VIEW_CHANNELS.goForward, (_event, input: BrowserViewIdInput): void => {
    const wc = requireView(input.viewId).view.webContents;
    if (wc.navigationHistory && typeof wc.navigationHistory.goForward === 'function') {
      wc.navigationHistory.goForward();
    } else if (typeof (wc as unknown as { goForward?: () => void }).goForward === 'function') {
      (wc as unknown as { goForward: () => void }).goForward();
    }
  });

  ipcMain.handle(BROWSER_VIEW_CHANNELS.reload, (_event, input: BrowserViewIdInput): void => {
    requireView(input.viewId).view.webContents.reload();
  });

  ipcMain.handle(BROWSER_VIEW_CHANNELS.stop, (_event, input: BrowserViewIdInput): void => {
    requireView(input.viewId).view.webContents.stop();
  });

  ipcMain.handle(BROWSER_VIEW_CHANNELS.send, (_event, input: BrowserViewSendInput): void => {
    const wc = requireView(input.viewId).view.webContents;
    wc.send(input.channel, ...input.args);
  });

  ipcMain.handle(BROWSER_VIEW_CHANNELS.capturePage, async (_event, input: BrowserViewIdInput): Promise<BrowserViewCapturePageOutput> => {
    const wc = requireView(input.viewId).view.webContents;
    const image = await wc.capturePage();
    return { dataUrl: image.toDataURL() };
  });

  // Phase 4 will use this to keep the preload path in sync if the renderer
  // resolves it lazily. Today it's a no-op when called against an already-
  // created view because Electron only honors `webPreferences.preload` at
  // construction time. Kept on the wire so the contract is stable.
  ipcMain.handle(BROWSER_VIEW_CHANNELS.setPreload, (_event, _input: BrowserViewIdInput & { preloadPath: string }): void => {
    // Intentionally empty — see comment above. The view was already created
    // with the preload path passed to `create`, which is the only spot
    // Electron's WebContents reads from.
  });
}
