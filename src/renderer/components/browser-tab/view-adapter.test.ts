import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserViewEvent } from '../../../shared/browser-view-contract';

/**
 * Tests for the renderer-side ViewAdapter — A5 Phase 3 covers the
 * ResizeObserver + window-resize wiring inside `createWebContentsViewAdapter`.
 *
 * Vitest environment is `node`, so document / window / ResizeObserver have to
 * be stubbed manually. This file does not import any Node built-ins so it
 * loads cleanly past the pre-existing vitest+vite-7 resolver regression
 * documented in docs/IMPROVEMENTS.md.
 */

interface FakePlaceholder {
  className: string;
  dataset: Record<string, string>;
  style: Record<string, string>;
  offsetParent: unknown;
  rect: { left: number; top: number; width: number; height: number };
  getBoundingClientRect(): DOMRect;
}

let resizeObserverCallback: (() => void) | null = null;
let resizeObserverDisconnects = 0;
let placeholder: FakePlaceholder;
let rafCallbacks: Array<() => void> = [];
let rafCancelled = 0;
let windowResizeHandlers: Array<() => void> = [];

const setBoundsMock = vi.fn();
const navigateMock = vi.fn();
const destroyMock = vi.fn();
const onEventMock = vi.fn();
const goBackMock = vi.fn();
const goForwardMock = vi.fn();
const reloadMock = vi.fn();
const stopMock = vi.fn();
const sendMock = vi.fn();
const capturePageMock = vi.fn();
const setPreloadMock = vi.fn();

let createResolver: ((res: { viewId: string }) => void) | null = null;
let onEventUnsubscribe = vi.fn();

function makePlaceholder(): FakePlaceholder {
  return {
    className: '',
    dataset: {},
    style: {},
    offsetParent: {} as unknown,
    rect: { left: 100, top: 50, width: 800, height: 600 },
    getBoundingClientRect(): DOMRect {
      return {
        x: this.rect.left,
        y: this.rect.top,
        left: this.rect.left,
        top: this.rect.top,
        width: this.rect.width,
        height: this.rect.height,
        right: this.rect.left + this.rect.width,
        bottom: this.rect.top + this.rect.height,
        toJSON: () => ({}),
      } as DOMRect;
    },
  };
}

function flushRaf(): void {
  const callbacks = rafCallbacks;
  rafCallbacks = [];
  for (const cb of callbacks) cb();
}

beforeEach(() => {
  resizeObserverCallback = null;
  resizeObserverDisconnects = 0;
  rafCallbacks = [];
  rafCancelled = 0;
  windowResizeHandlers = [];
  setBoundsMock.mockReset();
  navigateMock.mockReset();
  destroyMock.mockReset();
  onEventMock.mockReset();
  goBackMock.mockReset();
  goForwardMock.mockReset();
  reloadMock.mockReset();
  stopMock.mockReset();
  sendMock.mockReset();
  capturePageMock.mockReset();
  setPreloadMock.mockReset();
  onEventUnsubscribe = vi.fn();
  onEventMock.mockReturnValue(onEventUnsubscribe);

  placeholder = makePlaceholder();

  vi.stubGlobal('document', {
    createElement: (_tag: string) => placeholder as unknown as HTMLElement,
  });

  vi.stubGlobal('window', {
    aiyard: {
      browserView: {
        create: vi.fn(() =>
          new Promise<{ viewId: string }>((resolve) => {
            createResolver = resolve;
          }),
        ),
        destroy: destroyMock,
        setBounds: setBoundsMock,
        navigate: navigateMock,
        goBack: goBackMock,
        goForward: goForwardMock,
        reload: reloadMock,
        stop: stopMock,
        send: sendMock,
        capturePage: capturePageMock,
        setPreload: setPreloadMock,
        onEvent: onEventMock,
      },
    },
    addEventListener: (event: string, handler: () => void) => {
      if (event === 'resize') windowResizeHandlers.push(handler);
    },
    removeEventListener: (event: string, handler: () => void) => {
      if (event === 'resize') {
        windowResizeHandlers = windowResizeHandlers.filter((h) => h !== handler);
      }
    },
  });

  vi.stubGlobal(
    'ResizeObserver',
    class FakeResizeObserver {
      constructor(cb: () => void) {
        resizeObserverCallback = cb;
      }
      observe(): void {}
      disconnect(): void {
        resizeObserverDisconnects++;
      }
      unobserve(): void {}
    },
  );

  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });

  vi.stubGlobal('cancelAnimationFrame', (_token: number) => {
    rafCancelled++;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  createResolver = null;
});

async function resolveCreate(viewId = 'bv-1'): Promise<void> {
  // The adapter wraps create() behind `Promise.resolve(preloadPath).then(...)`,
  // so create() isn't invoked until at least one microtask has drained after
  // construction. Flush a few cycles before asserting the resolver exists.
  for (let i = 0; i < 4 && !createResolver; i++) await Promise.resolve();
  if (!createResolver) throw new Error('create not pending');
  createResolver({ viewId });
  // Two microtask flushes — one for the create promise, one for the .then chain.
  await Promise.resolve();
  await Promise.resolve();
}

describe('createWebContentsViewAdapter — Phase 3 positioning', () => {
  it('sends initial bounds after create resolves, rounded from getBoundingClientRect', async () => {
    placeholder.rect = { left: 12.4, top: 50.7, width: 800.3, height: 600.6 };
    const { createWebContentsViewAdapter } = await import('./view-adapter');
    createWebContentsViewAdapter({ tabId: 't1', preloadPath: '/p.js' });

    await resolveCreate('bv-1');
    expect(rafCallbacks.length).toBe(1);
    flushRaf();

    expect(setBoundsMock).toHaveBeenCalledTimes(1);
    expect(setBoundsMock).toHaveBeenCalledWith('bv-1', { x: 12, y: 51, width: 800, height: 601 });
  });

  it('coalesces 5 rapid ResizeObserver fires into a single setBounds call after rAF', async () => {
    const { createWebContentsViewAdapter } = await import('./view-adapter');
    createWebContentsViewAdapter({ tabId: 't1', preloadPath: '/p.js' });

    await resolveCreate('bv-1');
    flushRaf();
    setBoundsMock.mockClear();

    // 5 rapid mutations — only one rAF should be scheduled.
    placeholder.rect = { left: 0, top: 0, width: 1024, height: 768 };
    for (let i = 0; i < 5; i++) resizeObserverCallback?.();

    expect(rafCallbacks.length).toBe(1);
    flushRaf();
    expect(setBoundsMock).toHaveBeenCalledTimes(1);
    expect(setBoundsMock).toHaveBeenCalledWith('bv-1', { x: 0, y: 0, width: 1024, height: 768 });
  });

  it('emits a zero rect when the placeholder is hidden (offsetParent === null)', async () => {
    const { createWebContentsViewAdapter } = await import('./view-adapter');
    createWebContentsViewAdapter({ tabId: 't1', preloadPath: '/p.js' });

    await resolveCreate('bv-1');
    flushRaf(); // initial rect
    setBoundsMock.mockClear();

    placeholder.offsetParent = null;
    resizeObserverCallback?.();
    flushRaf();

    expect(setBoundsMock).toHaveBeenCalledWith('bv-1', { x: 0, y: 0, width: 0, height: 0 });
  });

  it('skips redundant setBounds when the rect is unchanged', async () => {
    const { createWebContentsViewAdapter } = await import('./view-adapter');
    createWebContentsViewAdapter({ tabId: 't1', preloadPath: '/p.js' });

    await resolveCreate('bv-1');
    flushRaf(); // initial push
    expect(setBoundsMock).toHaveBeenCalledTimes(1);

    // Observer fires again with no geometry change — second push must be elided.
    resizeObserverCallback?.();
    flushRaf();
    expect(setBoundsMock).toHaveBeenCalledTimes(1);
  });

  it('queues bounds when the viewId is not yet resolved and flushes on resolution', async () => {
    const { createWebContentsViewAdapter } = await import('./view-adapter');
    createWebContentsViewAdapter({ tabId: 't1', preloadPath: '/p.js' });

    // Trigger the observer before create resolves.
    resizeObserverCallback?.();
    flushRaf();
    expect(setBoundsMock).not.toHaveBeenCalled();

    await resolveCreate('bv-1');
    // Adapter's own post-resolve `scheduleBoundsUpdate` produces a single rAF.
    flushRaf();

    expect(setBoundsMock).toHaveBeenCalledTimes(1);
    expect(setBoundsMock).toHaveBeenCalledWith('bv-1', { x: 100, y: 50, width: 800, height: 600 });
  });

  it('window resize triggers a bounds update', async () => {
    const { createWebContentsViewAdapter } = await import('./view-adapter');
    createWebContentsViewAdapter({ tabId: 't1', preloadPath: '/p.js' });

    await resolveCreate('bv-1');
    flushRaf(); // initial
    setBoundsMock.mockClear();

    placeholder.rect = { left: 0, top: 0, width: 1920, height: 1080 };
    expect(windowResizeHandlers).toHaveLength(1);
    windowResizeHandlers[0]();
    flushRaf();

    expect(setBoundsMock).toHaveBeenCalledTimes(1);
    expect(setBoundsMock).toHaveBeenCalledWith('bv-1', { x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('destroy disconnects the observer and removes the resize listener', async () => {
    const { createWebContentsViewAdapter } = await import('./view-adapter');
    const adapter = createWebContentsViewAdapter({ tabId: 't1', preloadPath: '/p.js' });

    await resolveCreate('bv-1');
    flushRaf();
    setBoundsMock.mockClear();

    adapter.destroy();
    expect(resizeObserverDisconnects).toBe(1);
    expect(windowResizeHandlers).toHaveLength(0);
    expect(destroyMock).toHaveBeenCalledWith('bv-1');

    // Any later observer/window event must not produce IPC traffic.
    resizeObserverCallback?.();
    flushRaf();
    expect(setBoundsMock).not.toHaveBeenCalled();
  });

  it('destroy cancels a pending rAF so a queued bounds push cannot fire', async () => {
    const { createWebContentsViewAdapter } = await import('./view-adapter');
    const adapter = createWebContentsViewAdapter({ tabId: 't1', preloadPath: '/p.js' });

    await resolveCreate('bv-1');
    flushRaf();
    setBoundsMock.mockClear();

    placeholder.rect = { left: 5, top: 5, width: 100, height: 100 };
    resizeObserverCallback?.();
    expect(rafCallbacks.length).toBe(1);

    adapter.destroy();
    expect(rafCancelled).toBeGreaterThanOrEqual(1);

    // Even if the rAF fires (cancellation is best-effort in the polyfill),
    // the destroyed guard inside flushBounds short-circuits it.
    flushRaf();
    expect(setBoundsMock).not.toHaveBeenCalled();
  });

  it('subscribes to onEvent with the resolved viewId and dispatches did-navigate', async () => {
    const { createWebContentsViewAdapter } = await import('./view-adapter');
    const adapter = createWebContentsViewAdapter({ tabId: 't1', preloadPath: '/p.js' });

    const navSpy = vi.fn();
    adapter.onDidNavigate(navSpy);

    await resolveCreate('bv-1');
    expect(onEventMock).toHaveBeenCalledTimes(1);
    expect(onEventMock.mock.calls[0][0]).toBe('bv-1');

    const dispatch = onEventMock.mock.calls[0][1] as (e: BrowserViewEvent) => void;
    dispatch({ kind: 'did-navigate', viewId: 'bv-1', url: 'https://example.com' });
    expect(navSpy).toHaveBeenCalledWith('https://example.com');
    expect(adapter.getSrc()).toBe('https://example.com');
  });
});
