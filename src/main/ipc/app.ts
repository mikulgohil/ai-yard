import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProviderId } from '../../shared/types';
import { checkForUpdates, quitAndInstall } from '../auto-updater';
import { setCloseConfirmed } from '../close-state';
import { createAppMenu } from '../menu';
import { analyzeReadiness } from '../readiness/analyzer';
import { type TelemetryDataValue, type TelemetryEvent, track } from '../telemetry';

const TELEMETRY_EVENTS = new Set<TelemetryEvent>(['app.launch', 'session.start', 'feature.used']);

function sanitizeTelemetryData(input: unknown): Record<string, TelemetryDataValue> {
  if (input === null || typeof input !== 'object') return {};
  const out: Record<string, TelemetryDataValue> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      // String length cap as a defense-in-depth measure: keeps a buggy renderer
      // from accidentally shipping large blobs (e.g. file contents) over telemetry.
      out[key] = typeof value === 'string' && value.length > 200 ? value.slice(0, 200) : value;
    }
  }
  return out;
}

/**
 * App-lifecycle and miscellaneous IPC handlers.
 * Extracted from ipc-handlers.ts (docs/IMPROVEMENTS.md B7). No behavior change.
 *
 * Covers: window focus / close confirmation, version, browser preload path,
 * external URL opener, menu rebuild, clipboard, browser-tab screenshots,
 * auto-updater controls, stats cache, and readiness analyzer.
 */

const MAX_SCREENSHOT_BYTES = 50 * 1024 * 1024;
const MAX_SCREENSHOT_B64_LEN = Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3);
const SCREENSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let screenshotsPruned = false;

async function pruneOldScreenshots(dir: string): Promise<void> {
  try {
    const entries = await fs.promises.readdir(dir);
    const now = Date.now();
    await Promise.all(entries.map(async (name) => {
      const full = path.join(dir, name);
      try {
        const stat = await fs.promises.stat(full);
        if (now - stat.mtimeMs > SCREENSHOT_MAX_AGE_MS) {
          await fs.promises.unlink(full);
        }
      } catch (err) {
        console.warn('Failed to prune screenshot', full, err);
      }
    }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('Failed to read screenshots dir for pruning', err);
    }
  }
}

export function registerAppIpcHandlers(): void {
  ipcMain.handle('menu:rebuild', (_event, debugMode: boolean) => {
    createAppMenu(debugMode);
  });

  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(text);
    // Also write to X11 primary selection on Linux so middle-click paste works
    if (process.platform === 'linux') clipboard.writeText(text, 'selection');
  });

  ipcMain.on('app:focus', () => {
    app.focus({ steal: true });
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  ipcMain.on('app:closeConfirmed', () => {
    setCloseConfirmed(true);
    app.quit();
  });

  ipcMain.handle('app:getVersion', () => app.getVersion());

  ipcMain.handle('app:getBrowserPreloadPath', () =>
    path.join(__dirname, '..', '..', 'preload', 'preload', 'browser-tab-preload.js')
  );

  ipcMain.handle('app:openExternal', (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Only HTTP(S) URLs are allowed');
    }
    return shell.openExternal(url);
  });

  ipcMain.handle('browser:saveScreenshot', async (_event, sessionId: string, dataUrl: string) => {
    const PREFIX = 'data:image/png;base64,';
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PREFIX)) {
      throw new Error('Invalid screenshot data URL');
    }
    const b64 = dataUrl.slice(PREFIX.length);
    if (b64.length > MAX_SCREENSHOT_B64_LEN) {
      throw new Error('Screenshot data exceeds size limit');
    }
    const buffer = Buffer.from(b64, 'base64');
    const dir = path.join(os.tmpdir(), 'ai-yard-screenshots');
    await fs.promises.mkdir(dir, { recursive: true });
    if (!screenshotsPruned) {
      screenshotsPruned = true;
      void pruneOldScreenshots(dir);
    }
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(dir, `draw-${safeId}-${Date.now()}.png`);
    await fs.promises.writeFile(filePath, buffer);
    return filePath;
  });

  ipcMain.handle('update:checkNow', () => checkForUpdates());
  ipcMain.handle('update:install', () => quitAndInstall());

  ipcMain.handle('stats:getCache', () => {
    try {
      const statsPath = path.join(os.homedir(), '.claude', 'stats-cache.json');
      const raw = fs.readFileSync(statsPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });

  ipcMain.handle('readiness:analyze', (_event, projectPath: string, excludedProviders?: ProviderId[]) => analyzeReadiness(projectPath, excludedProviders));

  // Fire-and-forget telemetry channel. Renderer cannot await — keeps feature.used
  // events off the hot path. Validates the event name and strips non-primitive data.
  ipcMain.on('telemetry:track', (_event, eventName: unknown, data: unknown) => {
    if (typeof eventName !== 'string' || !TELEMETRY_EVENTS.has(eventName as TelemetryEvent)) return;
    track(eventName as TelemetryEvent, sanitizeTelemetryData(data));
  });
}
