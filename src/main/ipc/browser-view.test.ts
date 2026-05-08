import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_VIEW_CHANNELS } from '../../shared/browser-view-contract';

/**
 * Tests for the WebContentsView IPC module (A5 Phase 2).
 *
 * These tests mock the entire `electron` module so the file is loadable
 * outside an Electron context. They cover the create/destroy lifecycle,
 * forwarding to webContents methods, the broadcast event channel, and the
 * preconditions on each handler.
 *
 * Notes:
 *  - We deliberately do NOT use bare `import * as fs from 'fs'` here — see
 *    the pre-existing vitest+vite-7 resolver regression documented in
 *    docs/IMPROVEMENTS.md (37 main-process test files affected). This file
 *    has no Node-builtin imports so it should load cleanly.
 *  - The handler module registers via `ipcMain.handle` at import time of
 *    `registerBrowserViewIpcHandlers()`. We swap the mocked `ipcMain.handle`
 *    in for each test so we can drive the registered handler fns directly.
 */

interface FakeWebContents {
  send: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  capturePage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  navigationHistory: { goBack: ReturnType<typeof vi.fn>; goForward: ReturnType<typeof vi.fn> };
}

interface FakeWebContentsView {
  webContents: FakeWebContents;
  setBounds: ReturnType<typeof vi.fn>;
}

interface FakeBrowserWindow {
  isDestroyed: () => boolean;
  webContents: { send: ReturnType<typeof vi.fn> };
  contentView: {
    addChildView: ReturnType<typeof vi.fn>;
    removeChildView: ReturnType<typeof vi.fn>;
  };
}

const mockBrowserWindow: FakeBrowserWindow = {
  isDestroyed: () => false,
  webContents: { send: vi.fn() },
  contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
};

let createdViews: FakeWebContentsView[] = [];

function makeWebContents(): FakeWebContents {
  return {
    send: vi.fn(),
    loadURL: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn(),
    stop: vi.fn(),
    capturePage: vi.fn().mockResolvedValue({ toDataURL: () => 'data:image/png;base64,FAKE' }),
    close: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    navigationHistory: { goBack: vi.fn(), goForward: vi.fn() },
  };
}

const ipcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler);
    },
  },
  BrowserWindow: {
    getAllWindows: (): FakeBrowserWindow[] => [mockBrowserWindow],
  },
  // Use a `function` (not arrow) so the mock is constructable — vi.fn's
  // implementation is invoked under `new`, and arrow functions cannot be
  // constructors.
  WebContentsView: vi.fn(function FakeWebContentsViewCtor() {
    const view: FakeWebContentsView = {
      webContents: makeWebContents(),
      setBounds: vi.fn(),
    };
    createdViews.push(view);
    return view;
  }),
}));

import {
  _isAppAcceleratorForTesting,
  _peekForTesting,
  _resetForTesting,
  registerBrowserViewIpcHandlers,
} from './browser-view';

beforeEach(() => {
  ipcHandlers.clear();
  createdViews = [];
  mockBrowserWindow.contentView.addChildView.mockClear();
  mockBrowserWindow.contentView.removeChildView.mockClear();
  mockBrowserWindow.webContents.send.mockClear();
  registerBrowserViewIpcHandlers();
});

afterEach(() => {
  _resetForTesting();
});

function call<T = unknown>(channel: string, payload: unknown = undefined): T {
  const handler = ipcHandlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler({}, payload) as T;
}

describe('browser-view IPC handlers', () => {
  it('registers every channel listed in the contract', () => {
    for (const channel of Object.values(BROWSER_VIEW_CHANNELS)) {
      // The broadcast `event` channel is renderer-side only — main never `handle`s it.
      if (channel === BROWSER_VIEW_CHANNELS.event) continue;
      expect(ipcHandlers.has(channel)).toBe(true);
    }
  });

  it('create instantiates a WebContentsView, attaches it, navigates to the given URL, and returns a viewId', async () => {
    const result = call<{ viewId: string }>(BROWSER_VIEW_CHANNELS.create, {
      tabId: 'session-1',
      url: 'https://example.com',
      preloadPath: '/abs/preload.js',
    });

    expect(result.viewId).toMatch(/^bv-/);
    expect(createdViews).toHaveLength(1);
    const view = createdViews[0];
    expect(view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 0, height: 0 });
    expect(mockBrowserWindow.contentView.addChildView).toHaveBeenCalledWith(view);
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://example.com');

    // Listeners attached: one per event kind.
    const events = view.webContents.on.mock.calls.map((c) => c[0]);
    expect(events).toEqual(
      expect.arrayContaining(['did-navigate', 'did-navigate-in-page', 'ipc-message', 'before-input-event']),
    );

    // Module-level map tracks the view.
    expect(_peekForTesting(result.viewId)).toBeDefined();
  });

  it('create defaults to about:blank when no URL is given', () => {
    call(BROWSER_VIEW_CHANNELS.create, { tabId: 't', preloadPath: '/p.js' });
    expect(createdViews[0].webContents.loadURL).toHaveBeenCalledWith('about:blank');
  });

  it('setBounds forwards the rect to the underlying view', () => {
    const { viewId } = call<{ viewId: string }>(BROWSER_VIEW_CHANNELS.create, {
      tabId: 't', preloadPath: '/p.js',
    });
    call(BROWSER_VIEW_CHANNELS.setBounds, { viewId, rect: { x: 10, y: 20, width: 800, height: 600 } });
    expect(createdViews[0].setBounds).toHaveBeenLastCalledWith({ x: 10, y: 20, width: 800, height: 600 });
  });

  it('navigate calls loadURL on the view', () => {
    const { viewId } = call<{ viewId: string }>(BROWSER_VIEW_CHANNELS.create, {
      tabId: 't', preloadPath: '/p.js',
    });
    call(BROWSER_VIEW_CHANNELS.navigate, { viewId, url: 'https://other.example' });
    expect(createdViews[0].webContents.loadURL).toHaveBeenLastCalledWith('https://other.example');
  });

  it('goBack/goForward use navigationHistory when available', () => {
    const { viewId } = call<{ viewId: string }>(BROWSER_VIEW_CHANNELS.create, {
      tabId: 't', preloadPath: '/p.js',
    });
    call(BROWSER_VIEW_CHANNELS.goBack, { viewId });
    call(BROWSER_VIEW_CHANNELS.goForward, { viewId });
    expect(createdViews[0].webContents.navigationHistory.goBack).toHaveBeenCalledTimes(1);
    expect(createdViews[0].webContents.navigationHistory.goForward).toHaveBeenCalledTimes(1);
  });

  it('reload and stop forward to webContents', () => {
    const { viewId } = call<{ viewId: string }>(BROWSER_VIEW_CHANNELS.create, {
      tabId: 't', preloadPath: '/p.js',
    });
    call(BROWSER_VIEW_CHANNELS.reload, { viewId });
    call(BROWSER_VIEW_CHANNELS.stop, { viewId });
    expect(createdViews[0].webContents.reload).toHaveBeenCalledTimes(1);
    expect(createdViews[0].webContents.stop).toHaveBeenCalledTimes(1);
  });

  it('send forwards channel + args to webContents.send', () => {
    const { viewId } = call<{ viewId: string }>(BROWSER_VIEW_CHANNELS.create, {
      tabId: 't', preloadPath: '/p.js',
    });
    call(BROWSER_VIEW_CHANNELS.send, { viewId, channel: 'enter-inspect-mode', args: [42, 'hi'] });
    expect(createdViews[0].webContents.send).toHaveBeenCalledWith('enter-inspect-mode', 42, 'hi');
  });

  it('capturePage returns a data URL serialized from the underlying NativeImage', async () => {
    const { viewId } = call<{ viewId: string }>(BROWSER_VIEW_CHANNELS.create, {
      tabId: 't', preloadPath: '/p.js',
    });
    const result = await (call(BROWSER_VIEW_CHANNELS.capturePage, { viewId }) as Promise<{ dataUrl: string }>);
    expect(result.dataUrl).toBe('data:image/png;base64,FAKE');
  });

  it('destroy removes the view, releases listeners, and forgets the viewId', () => {
    const { viewId } = call<{ viewId: string }>(BROWSER_VIEW_CHANNELS.create, {
      tabId: 't', preloadPath: '/p.js',
    });
    const view = createdViews[0];
    call(BROWSER_VIEW_CHANNELS.destroy, { viewId });
    expect(mockBrowserWindow.contentView.removeChildView).toHaveBeenCalledWith(view);
    expect(view.webContents.close).toHaveBeenCalledTimes(1);
    expect(view.webContents.off).toHaveBeenCalledTimes(4); // one per attached listener
    expect(_peekForTesting(viewId)).toBeUndefined();
  });

  it('destroy is a no-op when called with an unknown viewId', () => {
    expect(() => call(BROWSER_VIEW_CHANNELS.destroy, { viewId: 'never-existed' })).not.toThrow();
  });

  it('throws for handlers that operate on an unknown viewId', () => {
    expect(() => call(BROWSER_VIEW_CHANNELS.setBounds, { viewId: 'nope', rect: { x: 0, y: 0, width: 0, height: 0 } }))
      .toThrow(/no view registered/);
    expect(() => call(BROWSER_VIEW_CHANNELS.navigate, { viewId: 'nope', url: 'https://x' }))
      .toThrow(/no view registered/);
  });

  it('did-navigate listener broadcasts a discriminated event payload to every window', () => {
    const { viewId } = call<{ viewId: string }>(BROWSER_VIEW_CHANNELS.create, {
      tabId: 't', preloadPath: '/p.js',
    });
    const wcOn = createdViews[0].webContents.on;
    const navCall = wcOn.mock.calls.find((c) => c[0] === 'did-navigate');
    expect(navCall).toBeDefined();
    const handler = navCall![1] as (event: unknown, url: string) => void;
    handler({}, 'https://example.com/landed');

    expect(mockBrowserWindow.webContents.send).toHaveBeenCalledWith(
      BROWSER_VIEW_CHANNELS.event,
      { kind: 'did-navigate', viewId, url: 'https://example.com/landed' },
    );
  });

  it('before-input-event listener flattens Electron.Input into the BrowserViewKeyEvent shape', () => {
    const { viewId } = call<{ viewId: string }>(BROWSER_VIEW_CHANNELS.create, {
      tabId: 't', preloadPath: '/p.js',
    });
    const wcOn = createdViews[0].webContents.on;
    const inputCall = wcOn.mock.calls.find((c) => c[0] === 'before-input-event');
    const handler = inputCall![1] as (event: { preventDefault: () => void }, input: Record<string, unknown>) => void;
    const preventDefault = vi.fn();
    handler({ preventDefault }, { type: 'keyDown', key: 'a', shift: false, control: true, alt: false, meta: false, code: 'KeyA' });

    // 'a' isn't an app accelerator (Cmd+A is select-all in pages) → no suppression.
    expect(preventDefault).not.toHaveBeenCalled();
    expect(mockBrowserWindow.webContents.send).toHaveBeenLastCalledWith(
      BROWSER_VIEW_CHANNELS.event,
      {
        kind: 'before-input-event',
        viewId,
        input: { type: 'keyDown', key: 'a', shift: false, control: true, alt: false, meta: false },
      },
    );
  });

  it('before-input-event preventDefaults app accelerators synchronously and still broadcasts', () => {
    const { viewId } = call<{ viewId: string }>(BROWSER_VIEW_CHANNELS.create, {
      tabId: 't', preloadPath: '/p.js',
    });
    const wcOn = createdViews[0].webContents.on;
    const inputCall = wcOn.mock.calls.find((c) => c[0] === 'before-input-event');
    const handler = inputCall![1] as (event: { preventDefault: () => void }, input: Record<string, unknown>) => void;
    const preventDefault = vi.fn();
    // Cmd+W (close session) is an app accelerator.
    handler({ preventDefault }, { type: 'keyDown', key: 'w', shift: false, control: false, alt: false, meta: true, code: 'KeyW' });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(mockBrowserWindow.webContents.send).toHaveBeenLastCalledWith(
      BROWSER_VIEW_CHANNELS.event,
      {
        kind: 'before-input-event',
        viewId,
        input: { type: 'keyDown', key: 'w', shift: false, control: false, alt: false, meta: true },
      },
    );
  });

  describe('isAppAccelerator', () => {
    interface InputOverrides {
      type?: 'keyDown' | 'keyUp';
      key?: string;
      shift?: boolean;
      control?: boolean;
      alt?: boolean;
      meta?: boolean;
    }
    function input(over: InputOverrides): Electron.Input {
      return {
        type: 'keyDown',
        key: 'a',
        shift: false,
        control: false,
        alt: false,
        meta: false,
        ...over,
      } as unknown as Electron.Input;
    }

    it('treats CmdOrCtrl+W / +T / +F / +P / +1..9 / +[ +] / +\\ / +B / +J / +L / +- / += / +0 as accelerators', () => {
      for (const key of ['w', 't', 'f', 'p', '1', '5', '9', '[', ']', '\\', 'b', 'j', 'l', '-', '=', '0']) {
        expect(_isAppAcceleratorForTesting(input({ key, meta: true }))).toBe(true);
        expect(_isAppAcceleratorForTesting(input({ key, control: true }))).toBe(true);
      }
    });

    it('treats CmdOrCtrl+Shift+] / [ / N / F / D / G / U / I as accelerators', () => {
      for (const key of [']', '[', 'n', 'f', 'd', 'g', 'u', 'i']) {
        expect(_isAppAcceleratorForTesting(input({ key, meta: true, shift: true }))).toBe(true);
      }
    });

    it('does NOT treat universal text-editing combos as accelerators', () => {
      for (const key of ['s', 'z', 'y', 'c', 'v', 'x', 'a', 'r']) {
        expect(_isAppAcceleratorForTesting(input({ key, meta: true }))).toBe(false);
        expect(_isAppAcceleratorForTesting(input({ key, control: true }))).toBe(false);
      }
    });

    it('does NOT treat bare keys (no Cmd/Ctrl modifier) as accelerators', () => {
      expect(_isAppAcceleratorForTesting(input({ key: 'w' }))).toBe(false);
      expect(_isAppAcceleratorForTesting(input({ key: 'Escape' }))).toBe(false);
      expect(_isAppAcceleratorForTesting(input({ key: 'Enter', shift: true }))).toBe(false);
    });

    it('does NOT treat keyUp events as accelerators (suppression must only fire on keyDown)', () => {
      expect(_isAppAcceleratorForTesting(input({ type: 'keyUp', key: 'w', meta: true }))).toBe(false);
    });

    it('does NOT treat Alt-modified keystrokes as accelerators', () => {
      expect(_isAppAcceleratorForTesting(input({ key: 'w', meta: true, alt: true }))).toBe(false);
    });

    it('matches keys case-insensitively', () => {
      expect(_isAppAcceleratorForTesting(input({ key: 'W', meta: true }))).toBe(true);
      expect(_isAppAcceleratorForTesting(input({ key: 'F', meta: true, shift: true }))).toBe(true);
    });
  });

  it('setPreload is a no-op (preload is fixed at create time) and does not throw', () => {
    const { viewId } = call<{ viewId: string }>(BROWSER_VIEW_CHANNELS.create, {
      tabId: 't', preloadPath: '/p.js',
    });
    expect(() => call(BROWSER_VIEW_CHANNELS.setPreload, { viewId, preloadPath: '/different.js' })).not.toThrow();
  });
});
