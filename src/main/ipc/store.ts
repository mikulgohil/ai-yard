import { ipcMain } from 'electron';
import { loadState, type PersistedState, saveState } from '../store';

/**
 * Persistent state IPC handlers.
 * Extracted from ipc-handlers.ts (docs/IMPROVEMENTS.md B7). No behavior change.
 */
export function registerStoreIpcHandlers(): void {
  ipcMain.handle('store:load', () => {
    return loadState();
  });

  ipcMain.handle('store:save', (_event, state: PersistedState) => {
    saveState(state);
  });
}
