import { BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import type { GitFileEntry, RebaseTodo } from '../../shared/types';
import {
  checkoutGitBranch,
  createGitBranch,
  createManagedWorktree,
  deleteLocalBranch,
  getConflictedFile,
  getDefaultBranch,
  getGitDiff,
  getGitFiles,
  getGitRemoteUrl,
  getGitStatus,
  getGitWorktrees,
  getLastCommitMessage,
  localBranchExists,
  removeManagedWorktree,
  gitBisectBad,
  gitBisectGood,
  gitBisectReset,
  gitBisectRun,
  gitBisectStart,
  gitBlame,
  gitCheckoutHash,
  gitCherryPick,
  gitCherryPickAbort,
  gitCherryPickContinue,
  gitCommit,
  gitCompareBranches,
  gitCreateBranchAt,
  gitCreateTag,
  gitDeleteTag,
  gitDiscardFile,
  gitFetch,
  gitGrep,
  gitListTags,
  gitLog,
  gitLogGrep,
  gitPickaxe,
  gitPull,
  gitPush,
  gitPushAllTags,
  gitPushTag,
  gitRebaseAbort,
  gitRebaseApply,
  gitRebaseContinue,
  gitRebaseInteractiveTodo,
  gitReflog,
  gitResetTo,
  gitShowCommit,
  gitStageFile,
  gitStageHunk,
  gitStashApply,
  gitStashDrop,
  gitStashList,
  gitStashPop,
  gitStashPush,
  gitStashShow,
  gitSubmoduleList,
  gitSubmoduleSync,
  gitSubmoduleUpdate,
  gitUnstageFile,
  gitUnstageHunk,
  listGitBranches,
  resolveConflict,
} from '../git-status';
import { notifyGitChanged, startGitWatcher } from '../git-watcher';

/**
 * Register all `git:*` IPC handlers. Extracted from ipc-handlers.ts as part of
 * the IPC modularization (docs/IMPROVEMENTS.md B7). No behavior change.
 */
export function registerGitIpcHandlers(): void {
  ipcMain.handle('git:getStatus', (_event, projectPath: string) => getGitStatus(projectPath));

  ipcMain.handle('git:getRemoteUrl', (_event, projectPath: string) => getGitRemoteUrl(projectPath));

  ipcMain.handle('git:getFiles', (_event, projectPath: string) => getGitFiles(projectPath));

  ipcMain.handle('git:getDiff', (_event, projectPath: string, filePath: string, area: string) =>
    getGitDiff(projectPath, filePath, area),
  );

  ipcMain.handle('git:getWorktrees', (_event, projectPath: string) => getGitWorktrees(projectPath));

  ipcMain.handle('git:stageFile', async (_event, projectPath: string, filePath: string) => {
    await gitStageFile(projectPath, filePath);
    notifyGitChanged();
  });

  ipcMain.handle('git:unstageFile', async (_event, projectPath: string, filePath: string) => {
    await gitUnstageFile(projectPath, filePath);
    notifyGitChanged();
  });

  ipcMain.handle('git:discardFile', async (_event, projectPath: string, filePath: string, area: string) => {
    await gitDiscardFile(projectPath, filePath, area as GitFileEntry['area']);
    notifyGitChanged();
  });

  ipcMain.on('git:watchProject', (_event, projectPath: string) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    startGitWatcher(win, projectPath);
  });

  ipcMain.handle('git:listBranches', (_event, projectPath: string) => listGitBranches(projectPath));

  ipcMain.handle('git:checkoutBranch', async (_event, projectPath: string, branch: string) => {
    await checkoutGitBranch(projectPath, branch);
    notifyGitChanged();
  });

  ipcMain.handle('git:createBranch', async (_event, projectPath: string, branch: string) => {
    await createGitBranch(projectPath, branch);
    notifyGitChanged();
  });

  ipcMain.handle('git:openInEditor', (_event, projectPath: string, filePath: string) => {
    const fullPath = path.join(projectPath, filePath);
    return shell.openPath(fullPath);
  });

  // ---------------- G1: commit creation ----------------
  ipcMain.handle('git:commit', async (_event, projectPath: string, message: string, amend: boolean) => {
    const result = await gitCommit(projectPath, message, amend);
    notifyGitChanged();
    return result;
  });

  ipcMain.handle('git:getLastCommit', (_event, projectPath: string) => getLastCommitMessage(projectPath));

  // ---------------- G2: remote ops ----------------
  ipcMain.handle('git:fetch', async (_event, projectPath: string, remote?: string) => {
    const r = await gitFetch(projectPath, remote);
    notifyGitChanged();
    return r;
  });

  ipcMain.handle('git:pull', async (_event, projectPath: string, rebase: boolean) => {
    const r = await gitPull(projectPath, rebase);
    notifyGitChanged();
    return r;
  });

  ipcMain.handle(
    'git:push',
    async (_event, projectPath: string, opts: { setUpstream?: boolean; force?: boolean; branch?: string }) => {
      const r = await gitPush(projectPath, opts);
      notifyGitChanged();
      return r;
    },
  );

  // ---------------- G3: hunk staging ----------------
  ipcMain.handle('git:stageHunk', async (_event, projectPath: string, patch: string) => {
    await gitStageHunk(projectPath, patch);
    notifyGitChanged();
  });

  ipcMain.handle('git:unstageHunk', async (_event, projectPath: string, patch: string) => {
    await gitUnstageHunk(projectPath, patch);
    notifyGitChanged();
  });

  // ---------------- G4: stash ----------------
  ipcMain.handle('git:stashList', (_event, projectPath: string) => gitStashList(projectPath));

  ipcMain.handle(
    'git:stashPush',
    async (_event, projectPath: string, message?: string, includeUntracked?: boolean) => {
      await gitStashPush(projectPath, message, includeUntracked);
      notifyGitChanged();
    },
  );

  ipcMain.handle('git:stashPop', async (_event, projectPath: string, ref?: string) => {
    await gitStashPop(projectPath, ref);
    notifyGitChanged();
  });

  ipcMain.handle('git:stashApply', async (_event, projectPath: string, ref: string) => {
    await gitStashApply(projectPath, ref);
    notifyGitChanged();
  });

  ipcMain.handle('git:stashDrop', async (_event, projectPath: string, ref: string) => {
    await gitStashDrop(projectPath, ref);
    notifyGitChanged();
  });

  ipcMain.handle('git:stashShow', (_event, projectPath: string, ref: string) =>
    gitStashShow(projectPath, ref),
  );

  // ---------------- G5: history ----------------
  ipcMain.handle(
    'git:log',
    (_event, projectPath: string, opts?: { branch?: string; limit?: number; skip?: number; filePath?: string }) =>
      gitLog(projectPath, opts || {}),
  );

  ipcMain.handle('git:show', (_event, projectPath: string, hash: string) =>
    gitShowCommit(projectPath, hash),
  );

  // ---------------- G6: blame ----------------
  ipcMain.handle('git:blame', (_event, projectPath: string, filePath: string) =>
    gitBlame(projectPath, filePath),
  );

  // ---------------- G7: tags ----------------
  ipcMain.handle('git:listTags', (_event, projectPath: string) => gitListTags(projectPath));

  ipcMain.handle(
    'git:createTag',
    async (_event, projectPath: string, name: string, message?: string, ref?: string) => {
      await gitCreateTag(projectPath, name, message, ref);
      notifyGitChanged();
    },
  );

  ipcMain.handle('git:deleteTag', async (_event, projectPath: string, name: string) => {
    await gitDeleteTag(projectPath, name);
    notifyGitChanged();
  });

  ipcMain.handle('git:pushTag', async (_event, projectPath: string, name: string) => {
    const r = await gitPushTag(projectPath, name);
    return r;
  });

  ipcMain.handle('git:pushAllTags', async (_event, projectPath: string) => {
    const r = await gitPushAllTags(projectPath);
    return r;
  });

  // ---------------- G8: reflog ----------------
  ipcMain.handle('git:reflog', (_event, projectPath: string, limit?: number) =>
    gitReflog(projectPath, limit),
  );

  ipcMain.handle(
    'git:reset',
    async (_event, projectPath: string, hash: string, mode: 'soft' | 'mixed' | 'hard') => {
      await gitResetTo(projectPath, hash, mode);
      notifyGitChanged();
    },
  );

  ipcMain.handle('git:branchAt', async (_event, projectPath: string, branch: string, hash: string) => {
    await gitCreateBranchAt(projectPath, branch, hash);
    notifyGitChanged();
  });

  ipcMain.handle('git:checkoutHash', async (_event, projectPath: string, hash: string) => {
    await gitCheckoutHash(projectPath, hash);
    notifyGitChanged();
  });

  // ---------------- G9: branch compare ----------------
  ipcMain.handle('git:compareBranches', (_event, projectPath: string, base: string, head: string) =>
    gitCompareBranches(projectPath, base, head),
  );

  ipcMain.handle('git:defaultBranch', (_event, projectPath: string) => getDefaultBranch(projectPath));

  // ---------------- G10: conflicts ----------------
  ipcMain.handle('git:getConflictedFile', (_event, projectPath: string, filePath: string) =>
    getConflictedFile(projectPath, filePath),
  );

  ipcMain.handle(
    'git:resolveConflict',
    async (_event, projectPath: string, filePath: string, content: string) => {
      await resolveConflict(projectPath, filePath, content);
      notifyGitChanged();
    },
  );

  // ---------------- G15: bisect ----------------
  ipcMain.handle('git:bisectStart', (_event, projectPath: string, bad?: string, good?: string) =>
    gitBisectStart(projectPath, bad, good),
  );

  ipcMain.handle('git:bisectGood', (_event, projectPath: string, commit?: string) =>
    gitBisectGood(projectPath, commit),
  );

  ipcMain.handle('git:bisectBad', (_event, projectPath: string, commit?: string) =>
    gitBisectBad(projectPath, commit),
  );

  ipcMain.handle('git:bisectReset', async (_event, projectPath: string) => {
    await gitBisectReset(projectPath);
    notifyGitChanged();
  });

  ipcMain.handle('git:bisectRun', (_event, projectPath: string, command: string) =>
    gitBisectRun(projectPath, command),
  );

  // ---------------- G18: code search ----------------
  ipcMain.handle('git:pickaxe', (_event, projectPath: string, query: string, limit?: number) =>
    gitPickaxe(projectPath, query, limit),
  );

  ipcMain.handle('git:grep', (_event, projectPath: string, query: string, ref?: string) =>
    gitGrep(projectPath, query, ref),
  );

  ipcMain.handle('git:logGrep', (_event, projectPath: string, pattern: string, limit?: number) =>
    gitLogGrep(projectPath, pattern, limit),
  );

  // ---------------- G19: rebase ----------------
  ipcMain.handle('git:rebaseTodo', (_event, projectPath: string, base: string) =>
    gitRebaseInteractiveTodo(projectPath, base),
  );

  ipcMain.handle(
    'git:rebaseApply',
    async (_event, projectPath: string, base: string, todos: RebaseTodo[]) => {
      const r = await gitRebaseApply(projectPath, base, todos);
      notifyGitChanged();
      return r;
    },
  );

  ipcMain.handle('git:rebaseContinue', async (_event, projectPath: string) => {
    const r = await gitRebaseContinue(projectPath);
    notifyGitChanged();
    return r;
  });

  ipcMain.handle('git:rebaseAbort', async (_event, projectPath: string) => {
    await gitRebaseAbort(projectPath);
    notifyGitChanged();
  });

  // ---------------- G20: cherry-pick ----------------
  ipcMain.handle('git:cherryPick', async (_event, projectPath: string, hash: string, noCommit?: boolean) => {
    const r = await gitCherryPick(projectPath, hash, noCommit);
    notifyGitChanged();
    return r;
  });

  ipcMain.handle('git:cherryPickContinue', async (_event, projectPath: string) => {
    const r = await gitCherryPickContinue(projectPath);
    notifyGitChanged();
    return r;
  });

  ipcMain.handle('git:cherryPickAbort', async (_event, projectPath: string) => {
    await gitCherryPickAbort(projectPath);
    notifyGitChanged();
  });

  // ---------------- G21: submodules ----------------
  ipcMain.handle('git:submoduleList', (_event, projectPath: string) => gitSubmoduleList(projectPath));

  ipcMain.handle('git:submoduleUpdate', async (_event, projectPath: string, recursive?: boolean) => {
    const r = await gitSubmoduleUpdate(projectPath, recursive);
    notifyGitChanged();
    return r;
  });

  ipcMain.handle('git:submoduleSync', async (_event, projectPath: string) => {
    await gitSubmoduleSync(projectPath);
    notifyGitChanged();
  });

  // ---------------- Worktree management ----------------
  ipcMain.handle(
    'git:createWorktree',
    async (_event, projectPath: string, projectId: string, branch: string, baseBranch: string) => {
      const result = await createManagedWorktree(projectPath, projectId, branch, baseBranch);
      notifyGitChanged();
      return result;
    },
  );

  ipcMain.handle('git:removeWorktree', async (_event, projectPath: string, worktreePath: string) => {
    await removeManagedWorktree(projectPath, worktreePath);
    notifyGitChanged();
  });

  ipcMain.handle('git:deleteBranch', async (_event, projectPath: string, branch: string) => {
    await deleteLocalBranch(projectPath, branch);
    notifyGitChanged();
  });

  ipcMain.handle('git:branchExists', (_event, projectPath: string, branch: string) =>
    localBranchExists(projectPath, branch),
  );
}
