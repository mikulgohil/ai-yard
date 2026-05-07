import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const STARTUP_DELAY_MS = 10_000; // 10 seconds

function sendToRenderer(channel: string, payload: Record<string, unknown>): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch(() => {});
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) return;

  // The auto-updater is currently dormant: package.json's electron-builder block has no `publish`
  // target after the Vibeyard → AI-yard rename (see docs/RENAME.md Tier 2 and docs/IMPROVEMENTS.md A4).
  // Without a publish target, electron-updater throws "No publish configuration found" on every check.
  // We suppress those errors here rather than spamming the renderer's update banner.
  // To re-enable: add a `publish` block to package.json's `build` field, then remove this guard.
  const updaterConfigured = false;
  if (!updaterConfigured) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    sendToRenderer('update:available', { version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('update:download-progress', { percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendToRenderer('update:downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    sendToRenderer('update:error', { message: err?.message ?? 'Unknown error' });
  });

  // Check after startup delay, then periodically
  setTimeout(checkForUpdates, STARTUP_DELAY_MS);
  setInterval(checkForUpdates, CHECK_INTERVAL_MS);
}
