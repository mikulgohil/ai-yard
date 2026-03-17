import { ipcMain, BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import { spawnPty, writePty, resizePty, killPty } from './pty-manager';
import { loadState, saveState, PersistedState } from './store';
import { getClaudeConfig } from './claude-cli';
import { startWatching, cleanupSessionStatus } from './hook-status';

let hookWatcherStarted = false;

export function registerIpcHandlers(): void {
  ipcMain.handle('pty:create', (_event, sessionId: string, cwd: string, claudeSessionId: string | null, isResume: boolean) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    // Start hook status watcher on first PTY creation (window is guaranteed to exist)
    if (!hookWatcherStarted) {
      startWatching(win);
      hookWatcherStarted = true;
    }

    spawnPty(
      sessionId,
      cwd,
      claudeSessionId,
      isResume,
      (data) => {
        const w = BrowserWindow.getAllWindows()[0];
        if (w && !w.isDestroyed()) {
          w.webContents.send('pty:data', sessionId, data);
        }
      },
      (exitCode, signal) => {
        cleanupSessionStatus(sessionId);
        const w = BrowserWindow.getAllWindows()[0];
        if (w && !w.isDestroyed()) {
          w.webContents.send('pty:exit', sessionId, exitCode, signal);
        }
      }
    );
  });

  ipcMain.on('pty:write', (_event, sessionId: string, data: string) => {
    writePty(sessionId, data);
  });

  ipcMain.on('pty:resize', (_event, sessionId: string, cols: number, rows: number) => {
    resizePty(sessionId, cols, rows);
  });

  ipcMain.handle('pty:kill', (_event, sessionId: string) => {
    killPty(sessionId);
  });

  ipcMain.handle('fs:isDirectory', (_event, path: string) => {
    try {
      return fs.statSync(path).isDirectory();
    } catch {
      return false;
    }
  });

  ipcMain.handle('store:load', () => {
    return loadState();
  });

  ipcMain.handle('store:save', (_event, state: PersistedState) => {
    saveState(state);
  });

  ipcMain.handle('claude:getConfig', async (_event, projectPath: string) => {
    return getClaudeConfig(projectPath);
  });

  ipcMain.handle('app:getVersion', () => app.getVersion());
}
