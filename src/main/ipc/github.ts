import { ipcMain } from 'electron';
import { detectRepo, isGhAvailable, listIssues, listPullRequests } from '../github-cli';

/**
 * Register all `github:*` IPC handlers. Extracted from ipc-handlers.ts
 * (docs/IMPROVEMENTS.md B7). No behavior change.
 */
export function registerGithubIpcHandlers(): void {
  ipcMain.handle('github:isAvailable', () => isGhAvailable());

  ipcMain.handle('github:detectRepo', (_event, projectPath: string) => detectRepo(projectPath));

  ipcMain.handle('github:listPRs', (_event, repo: string, state: 'open' | 'closed' | 'all', max: number) =>
    listPullRequests(repo, { state, max }),
  );

  ipcMain.handle('github:listIssues', (_event, repo: string, state: 'open' | 'closed' | 'all', max: number) =>
    listIssues(repo, { state, max }),
  );
}
