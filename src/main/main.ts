import { app, BrowserWindow, dialog, powerMonitor, shell } from 'electron';
import * as path from 'path';
import { initAutoUpdater } from './auto-updater';
import { isCloseConfirmed, setCloseConfirmed } from './close-state';
import { stopGitWatcher } from './git-watcher';
import { restartAndResync } from './hook-status';
import { registerIpcHandlers, resetHookWatcher } from './ipc-handlers';
import { createAppMenu } from './menu';
import { isMac } from './platform';
import { checkPythonAvailable } from './prerequisites';
import { getAllProviders, initProviders } from './providers/registry';
import { killAllPtys } from './pty-manager';
import { initSentry } from './sentry';
import { flushState, loadState, saveState } from './store';
import { initTelemetry, track } from './telemetry';

let mainWindow: BrowserWindow | null = null;

function requestConfirmClose(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send('app:confirmClose');
  } else {
    setCloseConfirmed(true);
    app.quit();
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    title: 'AI-yard',
    icon: path.join(__dirname, '..', '..', '..', 'build', 'icon.png'),
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // needed for node-pty IPC
      webviewTag: true, // needed for browser-tab sessions
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));

  // Open external links in default browser instead of inside the app
  const isHttpUrl = (url: string) => url.startsWith('http://') || url.startsWith('https://');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (isHttpUrl(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('close', (event) => {
    if (!isCloseConfirmed()) {
      event.preventDefault();
      requestConfirmClose();
      return;
    }
    flushState();
  });

  mainWindow.on('closed', () => {
    killAllPtys();
    resetHookWatcher();
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  initProviders();

  const providers = getAllProviders();
  const missing = providers.filter(p => !p.validatePrerequisites());
  for (const p of missing) {
    console.warn(`Provider "${p.meta.displayName}" not available`);
  }
  // AIYARD_E2E=1 lets the Playwright smoke test boot the app on machines with no CLI providers
  // installed (typical CI environments). Production builds always run the full check.
  const skipProviderCheck = process.env.AIYARD_E2E === '1';
  if (!skipProviderCheck && missing.length === providers.length) {
    const bullets = providers.map(p => `  • ${p.meta.displayName}`).join('\n');
    dialog.showErrorBox(
      'AI-yard — No CLI Provider Found',
      `AI-yard needs at least one supported CLI provider installed to run.\n\n` +
        `Install one of the following, then restart AI-yard:\n\n${bullets}`,
    );
    app.quit();
    return;
  }

  registerIpcHandlers();
  const state = loadState();
  initSentry(state.preferences);
  initTelemetry({
    prefs: state.preferences,
    deviceId: state.telemetryDeviceId,
    onDeviceIdGenerated: (id) => {
      state.telemetryDeviceId = id;
      saveState(state);
    },
  });
  const availableProviders = providers
    .filter(p => p.validatePrerequisites())
    .map(p => p.meta.id)
    .sort()
    .join(',');
  track('app.launch', {
    providersAvailable: availableProviders,
    providerCount: providers.length - missing.length,
  });
  createAppMenu(state.preferences?.debugMode ?? false);
  createWindow();

  // Warn if Python is missing on Windows (hooks depend on it)
  const pythonWarning = checkPythonAvailable();
  if (pythonWarning) {
    console.warn(pythonWarning);
    dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      title: 'AI-yard — Python Not Found',
      message: pythonWarning,
    });
  }

  // Install hooks and status scripts for available providers (after window creation so dialogs can attach)
  for (const provider of getAllProviders()) {
    if (provider.validatePrerequisites()) {
      await provider.installHooks(mainWindow);
      provider.installStatusScripts();
    }
  }

  initAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        restartAndResync(win);
      }
    }
  });

  powerMonitor.on('resume', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      restartAndResync(win);
    }
  });
});

app.on('before-quit', (event) => {
  if (!isCloseConfirmed()) {
    event.preventDefault();
    requestConfirmClose();
    return;
  }
  flushState();
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send('app:quitting');
  }
  killAllPtys();
  stopGitWatcher();
  // Cleanup all providers
  for (const provider of getAllProviders()) {
    provider.cleanup();
  }
});

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit();
  }
});
