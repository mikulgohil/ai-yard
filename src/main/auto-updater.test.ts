import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn().mockResolvedValue({}),
    quitAndInstall: vi.fn(),
    on: vi.fn(),
  },
}));

const mockSend = vi.fn();

vi.mock('electron', () => ({
  app: { isPackaged: true },
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mockSend } }],
  },
}));

import { autoUpdater } from 'electron-updater';
import { checkForUpdates, initAutoUpdater, quitAndInstall } from './auto-updater';

describe('auto-updater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  // The auto-updater is currently dormant — see docs/IMPROVEMENTS.md A4 and the comment in
  // auto-updater.ts. While dormant, initAutoUpdater() is a no-op even in packaged builds.
  // When the publish target is restored, replace these tests with the original "registers listeners
  // and schedules check" suite — preserved in git history at commit prior to A4 landing.
  it('initAutoUpdater is a no-op while the updater is dormant', () => {
    initAutoUpdater();
    expect(autoUpdater.on).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(autoUpdater.autoDownload).toBe(false);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it('checkForUpdates delegates to autoUpdater (still callable via IPC)', () => {
    checkForUpdates();
    expect(autoUpdater.checkForUpdates).toHaveBeenCalled();
  });

  it('quitAndInstall delegates to autoUpdater (still callable via IPC)', () => {
    quitAndInstall();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalled();
  });

  it('skips initialization in dev mode', async () => {
    vi.resetModules();
    vi.doMock('electron', () => ({
      app: { isPackaged: false },
      BrowserWindow: { getAllWindows: () => [] },
    }));
    vi.doMock('electron-updater', () => ({
      autoUpdater: {
        autoDownload: false,
        autoInstallOnAppQuit: false,
        checkForUpdates: vi.fn(),
        quitAndInstall: vi.fn(),
        on: vi.fn(),
      },
    }));
    const mod = await import('./auto-updater');
    const { autoUpdater: freshUpdater } = await import('electron-updater');
    mod.initAutoUpdater();
    expect(freshUpdater.on).not.toHaveBeenCalled();
  });
});
