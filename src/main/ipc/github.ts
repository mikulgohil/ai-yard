import { ipcMain } from 'electron';
import {
  addPrComment,
  detectRepo,
  getCiStatus,
  getPrComments,
  getPrDetail,
  getPrFiles,
  getRepoStats,
  isGhAvailable,
  listIssues,
  listPullRequests,
  submitPrReview,
} from '../github-cli';

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

  // ---------------- G13: PR review ----------------
  ipcMain.handle('github:prDetail', (_event, repo: string, prNumber: number) =>
    getPrDetail(repo, prNumber),
  );

  ipcMain.handle('github:prFiles', (_event, repo: string, prNumber: number) =>
    getPrFiles(repo, prNumber),
  );

  ipcMain.handle('github:prComments', (_event, repo: string, prNumber: number) =>
    getPrComments(repo, prNumber),
  );

  ipcMain.handle(
    'github:submitReview',
    (_event, repo: string, prNumber: number, event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES', body: string) =>
      submitPrReview(repo, prNumber, event, body),
  );

  ipcMain.handle(
    'github:addComment',
    (_event, repo: string, prNumber: number, filePath: string, line: number, body: string) =>
      addPrComment(repo, prNumber, filePath, line, body),
  );

  // ---------------- G16: CI status ----------------
  ipcMain.handle('github:ciStatus', (_event, repo: string, ref: string) => getCiStatus(repo, ref));

  // ---------------- G17: repo stats ----------------
  ipcMain.handle('github:repoStats', (_event, repo: string) => getRepoStats(repo));
}
