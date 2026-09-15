import type { ExecFileException } from 'child_process';
import { vi } from 'vitest';

// Mock child_process and fs before importing the module
vi.mock('child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  promises: {
    rm: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('os', () => ({
  tmpdir: () => '/tmp',
  homedir: () => '/home/user',
}));

import { execFile, spawn } from 'child_process';
import { promises as fsPromises, readFileSync } from 'fs';
import * as path from 'path';
import {
  createManagedWorktree,
  deleteLocalBranch,
  getGitDiff,
  getGitFiles,
  getGitStatus,
  getGitWorktrees,
  getManagedWorktreePath,
  gitCommit,
  gitDiscardFile,
  gitFetch,
  gitListTags,
  gitLog,
  gitPickaxe,
  gitPull,
  gitPush,
  gitReflog,
  gitStashList,
  gitSubmoduleList,
  localBranchExists,
  removeManagedWorktree,
  slugifyForFs,
} from './git-status';

const mockExecFile = vi.mocked(execFile);
const mockSpawn = vi.mocked(spawn);
const mockReadFileSync = vi.mocked(readFileSync);
const mockRm = vi.mocked(fsPromises.rm);

function simulateExecFile(err: ExecFileException | null, stdout: string) {
  mockExecFile.mockImplementationOnce((_cmd, _args, _opts, callback) => {
    (callback as (err: ExecFileException | null, stdout: string) => void)(err, stdout);
    return undefined as never;
  });
}

function simulateSpawn(code: number, stdout = '', stderr = '') {
  mockSpawn.mockImplementationOnce(() => {
    const stdoutListeners: Array<(chunk: Buffer) => void> = [];
    const stderrListeners: Array<(chunk: Buffer) => void> = [];
    const closeListeners: Array<(code: number | null) => void> = [];
    queueMicrotask(() => {
      if (stdout) for (const fn of stdoutListeners) fn(Buffer.from(stdout));
      if (stderr) for (const fn of stderrListeners) fn(Buffer.from(stderr));
      for (const fn of closeListeners) fn(code);
    });
    return {
      stdout: { on: (ev: string, cb: (chunk: Buffer) => void) => { if (ev === 'data') stdoutListeners.push(cb); } },
      stderr: { on: (ev: string, cb: (chunk: Buffer) => void) => { if (ev === 'data') stderrListeners.push(cb); } },
      on: (ev: string, cb: (arg: unknown) => void) => {
        if (ev === 'close') closeListeners.push(cb as (code: number | null) => void);
      },
      kill: vi.fn(),
    } as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getGitStatus', () => {
  it('parses branch name', async () => {
    simulateExecFile(null, '# branch.head main\n');
    const status = await getGitStatus('/test');
    expect(status.isGitRepo).toBe(true);
    expect(status.branch).toBe('main');
  });

  it('parses ahead/behind', async () => {
    simulateExecFile(null, '# branch.head main\n# branch.ab +3 -1\n');
    const status = await getGitStatus('/test');
    expect(status.ahead).toBe(3);
    expect(status.behind).toBe(1);
  });

  it('counts staged changes (X != .)', async () => {
    simulateExecFile(null, '1 M. N... 100644 100644 100644 abc def file.ts\n');
    const status = await getGitStatus('/test');
    expect(status.staged).toBe(1);
    expect(status.modified).toBe(0);
  });

  it('counts working tree changes (Y != .)', async () => {
    simulateExecFile(null, '1 .M N... 100644 100644 100644 abc def file.ts\n');
    const status = await getGitStatus('/test');
    expect(status.staged).toBe(0);
    expect(status.modified).toBe(1);
  });

  it('counts both staged and modified', async () => {
    simulateExecFile(null, '1 MM N... 100644 100644 100644 abc def file.ts\n');
    const status = await getGitStatus('/test');
    expect(status.staged).toBe(1);
    expect(status.modified).toBe(1);
  });

  it('counts rename entries (type 2)', async () => {
    simulateExecFile(null, '2 R. N... 100644 100644 100644 abc def R100\told.ts\tnew.ts\n');
    const status = await getGitStatus('/test');
    expect(status.staged).toBe(1);
  });

  it('counts unmerged entries', async () => {
    simulateExecFile(null, 'u UU N... 100644 100644 100644 100644 abc def ghi file.ts\n');
    const status = await getGitStatus('/test');
    expect(status.conflicted).toBe(1);
  });

  it('counts untracked files', async () => {
    simulateExecFile(null, '? new-file.ts\n? another.ts\n');
    const status = await getGitStatus('/test');
    expect(status.untracked).toBe(2);
  });

  it('returns NOT_A_REPO on error', async () => {
    simulateExecFile(new Error('not a git repo') as ExecFileException, '');
    const status = await getGitStatus('/test');
    expect(status.isGitRepo).toBe(false);
    expect(status.branch).toBeNull();
  });

  it('handles complex output with all entry types', async () => {
    const output = [
      '# branch.head feature/test',
      '# branch.ab +2 -0',
      '1 M. N... 100644 100644 100644 abc def staged.ts',
      '1 .M N... 100644 100644 100644 abc def modified.ts',
      '2 R. N... 100644 100644 100644 abc def R100\told.ts\tnew.ts',
      'u UU N... 100644 100644 100644 100644 abc def ghi conflict.ts',
      '? untracked.ts',
      '',
    ].join('\n');

    simulateExecFile(null, output);
    const status = await getGitStatus('/test');

    expect(status.branch).toBe('feature/test');
    expect(status.ahead).toBe(2);
    expect(status.behind).toBe(0);
    expect(status.staged).toBe(2); // M. + R.
    expect(status.modified).toBe(1); // .M
    expect(status.conflicted).toBe(1);
    expect(status.untracked).toBe(1);
  });
});

describe('getGitFiles', () => {
  it('returns file entries with correct status and area', async () => {
    simulateExecFile(null, '1 A. N... 100644 100644 100644 abc def added.ts\n');
    const files = await getGitFiles('/test');
    expect(files).toEqual([{ path: 'added.ts', status: 'added', area: 'staged' }]);
  });

  it('creates entries for both staged and working changes', async () => {
    simulateExecFile(null, '1 MM N... 100644 100644 100644 abc def both.ts\n');
    const files = await getGitFiles('/test');
    expect(files).toHaveLength(2);
    expect(files[0]).toEqual({ path: 'both.ts', status: 'modified', area: 'staged' });
    expect(files[1]).toEqual({ path: 'both.ts', status: 'modified', area: 'working' });
  });

  it('handles rename entries with tab-delimited paths', async () => {
    simulateExecFile(null, '2 R. N... 100644 100644 100644 abc def R100\told.ts\tnew.ts\n');
    const files = await getGitFiles('/test');
    expect(files).toEqual([{ path: 'new.ts', status: 'renamed', area: 'staged' }]);
  });

  it('handles deleted files', async () => {
    simulateExecFile(null, '1 D. N... 100644 100644 100644 abc def removed.ts\n');
    const files = await getGitFiles('/test');
    expect(files).toEqual([{ path: 'removed.ts', status: 'deleted', area: 'staged' }]);
  });

  it('handles unmerged files', async () => {
    simulateExecFile(null, 'u UU N... 100644 100644 100644 100644 abc def ghi\tconflict.ts\n');
    const files = await getGitFiles('/test');
    expect(files).toEqual([{ path: 'conflict.ts', status: 'conflicted', area: 'conflicted' }]);
  });

  it('handles untracked files', async () => {
    simulateExecFile(null, '? new-file.ts\n');
    const files = await getGitFiles('/test');
    expect(files).toEqual([{ path: 'new-file.ts', status: 'untracked', area: 'untracked' }]);
  });

  it('returns empty array on error', async () => {
    simulateExecFile(new Error('not a git repo') as ExecFileException, '');
    const files = await getGitFiles('/test');
    expect(files).toEqual([]);
  });
});

describe('getGitDiff', () => {
  it('returns formatted diff for untracked files', async () => {
    mockReadFileSync.mockReturnValueOnce('line1\nline2\n');
    const diff = await getGitDiff('/test', 'new.ts', 'untracked');
    expect(diff).toContain('--- /dev/null');
    expect(diff).toContain('+++ b/new.ts');
    expect(diff).toContain('+line1');
    expect(diff).toContain('+line2');
  });

  it('returns error message when untracked file cannot be read', async () => {
    mockReadFileSync.mockImplementationOnce(() => { throw new Error('ENOENT'); });
    const diff = await getGitDiff('/test', 'missing.ts', 'untracked');
    expect(diff).toBe('(unable to read file)');
  });

  it('calls git diff --cached for staged files', async () => {
    simulateExecFile(null, 'diff --cached output');
    await getGitDiff('/test', 'file.ts', 'staged');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['diff', '--cached', '--', 'file.ts'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('calls git diff for working tree files', async () => {
    simulateExecFile(null, 'diff output');
    await getGitDiff('/test', 'file.ts', 'working');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['diff', '--', 'file.ts'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('returns "(no diff available)" on error with no stdout', async () => {
    mockExecFile.mockImplementationOnce((_cmd, _args, _opts, callback) => {
      (callback as (err: ExecFileException | null, stdout: string) => void)(
        new Error('err') as ExecFileException,
        '',
      );
      return undefined as never;
    });
    const diff = await getGitDiff('/test', 'file.ts', 'working');
    expect(diff).toBe('(no diff available)');
  });
});

describe('gitDiscardFile', () => {
  it('removes an untracked file via fs.rm with recursive+force', async () => {
    mockRm.mockResolvedValueOnce(undefined);
    await gitDiscardFile('/repo', 'new.ts', 'untracked');
    expect(mockRm).toHaveBeenCalledWith(path.join('/repo', 'new.ts'), { recursive: true, force: true });
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('removes an untracked folder (path with trailing slash)', async () => {
    mockRm.mockResolvedValueOnce(undefined);
    await gitDiscardFile('/repo', 'e2e/', 'untracked');
    expect(mockRm).toHaveBeenCalledWith(path.join('/repo', 'e2e/'), { recursive: true, force: true });
  });

  it('runs git checkout for working-tree changes', async () => {
    simulateExecFile(null, '');
    await gitDiscardFile('/repo', 'file.ts', 'working');
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['checkout', '--', 'file.ts'],
      expect.any(Object),
      expect.any(Function),
    );
    expect(mockRm).not.toHaveBeenCalled();
  });
});

describe('getGitWorktrees', () => {
  it('parses porcelain output with main and linked worktree', async () => {
    const output = [
      'worktree /repo',
      'HEAD abc1234567890abcdef1234567890abcdef123456',
      'branch refs/heads/main',
      '',
      'worktree /repo-feature',
      'HEAD def4567890abcdef1234567890abcdef1234567890',
      'branch refs/heads/feature-branch',
      '',
    ].join('\n');

    simulateExecFile(null, output);
    const worktrees = await getGitWorktrees('/repo');

    expect(worktrees).toHaveLength(2);
    expect(worktrees[0]).toEqual({
      path: '/repo',
      head: 'abc1234567890abcdef1234567890abcdef123456',
      branch: 'main',
      isBare: false,
    });
    expect(worktrees[1]).toEqual({
      path: '/repo-feature',
      head: 'def4567890abcdef1234567890abcdef1234567890',
      branch: 'feature-branch',
      isBare: false,
    });
  });

  it('handles detached HEAD worktree', async () => {
    const output = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo-detached',
      'HEAD def456',
      'detached',
      '',
    ].join('\n');

    simulateExecFile(null, output);
    const worktrees = await getGitWorktrees('/repo');

    expect(worktrees).toHaveLength(2);
    expect(worktrees[1]).toEqual({
      path: '/repo-detached',
      head: 'def456',
      branch: null,
      isBare: false,
    });
  });

  it('handles bare worktree', async () => {
    const output = [
      'worktree /repo.git',
      'HEAD abc123',
      'bare',
      '',
      'worktree /repo-wt',
      'HEAD def456',
      'branch refs/heads/main',
      '',
    ].join('\n');

    simulateExecFile(null, output);
    const worktrees = await getGitWorktrees('/repo.git');

    expect(worktrees).toHaveLength(2);
    expect(worktrees[0].isBare).toBe(true);
    expect(worktrees[0].branch).toBeNull();
    expect(worktrees[1].isBare).toBe(false);
    expect(worktrees[1].branch).toBe('main');
  });

  it('returns empty array on error', async () => {
    simulateExecFile(new Error('not a git repo') as ExecFileException, '');
    const worktrees = await getGitWorktrees('/test');
    expect(worktrees).toEqual([]);
  });

  it('handles single worktree (no linked)', async () => {
    const output = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
    ].join('\n');

    simulateExecFile(null, output);
    const worktrees = await getGitWorktrees('/repo');

    expect(worktrees).toHaveLength(1);
    expect(worktrees[0].path).toBe('/repo');
  });
});

describe('gitCommit', () => {
  it('runs git commit -m and returns the new hash and subject', async () => {
    simulateExecFile(null, '');
    simulateExecFile(null, 'a3f2bc1\nfeat: add login\n');
    const result = await gitCommit('/repo', 'feat: add login', false);
    expect(result).toEqual({ hash: 'a3f2bc1', subject: 'feat: add login' });
    expect(mockExecFile).toHaveBeenNthCalledWith(
      1,
      'git',
      ['commit', '-m', 'feat: add login'],
      expect.objectContaining({ cwd: '/repo', timeout: 60_000 }),
      expect.any(Function),
    );
  });

  it('adds --amend when requested', async () => {
    simulateExecFile(null, '');
    simulateExecFile(null, 'a3f2bc1\nfeat: add login\n');
    await gitCommit('/repo', 'feat: add login', true);
    expect(mockExecFile.mock.calls[0][1]).toEqual(['commit', '-m', 'feat: add login', '--amend']);
  });

  it('rejects when git commit fails', async () => {
    simulateExecFile(new Error('nothing to commit') as ExecFileException, '');
    await expect(gitCommit('/repo', 'feat: nope', false)).rejects.toThrow('nothing to commit');
  });
});

describe('gitFetch / gitPull / gitPush', () => {
  it('fetches origin with --prune', async () => {
    simulateSpawn(0, '', 'From origin\n');
    const result = await gitFetch('/repo', 'origin');
    expect(result.ok).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith('git', ['fetch', 'origin', '--prune'], { cwd: '/repo' });
  });

  it('pulls with --rebase when requested', async () => {
    simulateSpawn(0);
    await gitPull('/repo', true);
    expect(mockSpawn).toHaveBeenCalledWith('git', ['pull', '--rebase'], { cwd: '/repo' });
  });

  it('pulls without rebase when not requested', async () => {
    simulateSpawn(0);
    await gitPull('/repo', false);
    expect(mockSpawn).toHaveBeenCalledWith('git', ['pull'], { cwd: '/repo' });
  });

  it('pushes with -u origin <branch> when setUpstream is set', async () => {
    simulateSpawn(0);
    await gitPush('/repo', { setUpstream: true, branch: 'feat/x' });
    expect(mockSpawn).toHaveBeenCalledWith('git', ['push', '-u', 'origin', 'feat/x'], { cwd: '/repo' });
  });

  it('force-pushes with --force-with-lease, never --force', async () => {
    simulateSpawn(0);
    await gitPush('/repo', { force: true, setUpstream: true, branch: 'main' });
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('--force-with-lease');
    expect(args).not.toContain('--force');
  });

  it('returns stderr when the remote op fails', async () => {
    simulateSpawn(1, '', 'authentication failed');
    const result = await gitPush('/repo', {});
    expect(result.ok).toBe(false);
    expect(result.stderr).toBe('authentication failed');
  });
});

describe('gitLog', () => {
  it('parses formatted log output into CommitEntry list', async () => {
    const output = [
      'aaaa1111|bbbb2222 cccc3333|fix: bug|Alice|alice@x.com|2026-05-08 12:00:00 +0000|HEAD -> main, origin/main',
      'bbbb2222|cccc3333|feat: ui|Bob|bob@x.com|2026-05-07 10:00:00 +0000|',
      '',
    ].join('\n');
    simulateExecFile(null, output);
    const commits = await gitLog('/repo', { limit: 10 });
    expect(commits).toHaveLength(2);
    expect(commits[0].hash).toBe('aaaa1111');
    expect(commits[0].parents).toEqual(['bbbb2222', 'cccc3333']);
    expect(commits[0].subject).toBe('fix: bug');
    expect(commits[0].refs).toEqual(['HEAD -> main', 'origin/main']);
    expect(commits[1].refs).toEqual([]);
  });
});

describe('gitStashList', () => {
  it('parses stash entries', async () => {
    simulateExecFile(null, 'stash@{0}|WIP on main: abc f|2026-05-08 12:00:00 +0000\nstash@{1}|test stash|2026-05-07 10:00:00 +0000\n');
    const stashes = await gitStashList('/repo');
    expect(stashes).toHaveLength(2);
    expect(stashes[0].ref).toBe('stash@{0}');
    expect(stashes[1].message).toBe('test stash');
  });
});

describe('gitListTags', () => {
  it('parses tag entries', async () => {
    simulateExecFile(null, 'v1.0.0|abc1234|2026-05-08|Release 1.0.0\nv0.9.0|def5678|2026-04-01|Beta\n');
    const tags = await gitListTags('/repo');
    expect(tags).toHaveLength(2);
    expect(tags[0]).toEqual({ name: 'v1.0.0', hash: 'abc1234', date: '2026-05-08', subject: 'Release 1.0.0' });
  });
});

describe('gitReflog', () => {
  it('parses reflog entries', async () => {
    simulateExecFile(null, 'HEAD@{0}|abc123|commit: fix login|2026-05-08\nHEAD@{1}|def456|checkout: moving from main to feat|2026-05-07\n');
    const entries = await gitReflog('/repo');
    expect(entries).toHaveLength(2);
    expect(entries[0].action).toBe('commit: fix login');
  });
});

describe('gitPickaxe', () => {
  it('parses pickaxe matches', async () => {
    simulateExecFile(null, 'aaa|removed flag|Alice|2026-05-08\nbbb|added flag|Bob|2026-05-01\n');
    const matches = await gitPickaxe('/repo', 'flag');
    expect(matches).toHaveLength(2);
    expect(matches[0].subject).toBe('removed flag');
  });
});

describe('gitSubmoduleList', () => {
  it('parses submodule status', async () => {
    simulateExecFile(null, ' abcdef1 ext/lib (heads/main)\n-12345 ext/uninit\n+abc ext/dirty\n');
    const subs = await gitSubmoduleList('/repo');
    expect(subs).toHaveLength(3);
    expect(subs[0].status).toBe('initialized');
    expect(subs[1].status).toBe('uninitialized');
    expect(subs[2].status).toBe('modified');
  });

  it('returns [] on error', async () => {
    simulateExecFile(new Error('not in a repo') as ExecFileException, '');
    const subs = await gitSubmoduleList('/repo');
    expect(subs).toEqual([]);
  });
});

describe('slugifyForFs', () => {
  it('replaces forward slashes with dashes', () => {
    expect(slugifyForFs('aiyard/fix-login')).toBe('aiyard-fix-login');
  });

  it('lowercases input', () => {
    expect(slugifyForFs('FEATURE/Login')).toBe('feature-login');
  });

  it('strips characters that are not alphanumeric, dash, or underscore', () => {
    expect(slugifyForFs('feature/foo bar?!.baz')).toBe('feature-foo-bar-baz');
  });

  it('collapses repeated dashes', () => {
    expect(slugifyForFs('foo//bar')).toBe('foo-bar');
    expect(slugifyForFs('foo--bar')).toBe('foo-bar');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugifyForFs('---foo---')).toBe('foo');
  });

  it('falls back to "worktree" when input slugifies to empty', () => {
    expect(slugifyForFs('!!!')).toBe('worktree');
    expect(slugifyForFs('')).toBe('worktree');
  });

  it('preserves underscores and digits', () => {
    expect(slugifyForFs('feature_42/v2')).toBe('feature_42-v2');
  });
});

describe('getManagedWorktreePath', () => {
  it('roots paths under ~/.ai-yard/worktrees/<projectId>/<slug>', () => {
    const result = getManagedWorktreePath('proj-1', 'aiyard/fix');
    expect(result).toBe(path.join('/home/user', '.ai-yard', 'worktrees', 'proj-1', 'aiyard-fix'));
  });

  it('uses the slugified branch name as the dirname', () => {
    const result = getManagedWorktreePath('proj-1', 'FEATURE/My Branch');
    expect(result.endsWith(path.join('proj-1', 'feature-my-branch'))).toBe(true);
  });
});

describe('createManagedWorktree', () => {
  it('runs `git worktree add <path> -b <branch> <base>` and returns the destination', async () => {
    simulateExecFile(null, '');
    const result = await createManagedWorktree('/repo', 'proj-1', 'aiyard/x', 'main');
    expect(result.path).toBe(path.join('/home/user', '.ai-yard', 'worktrees', 'proj-1', 'aiyard-x'));

    const callArgs = mockExecFile.mock.calls[0];
    expect(callArgs[0]).toBe('git');
    expect(callArgs[1]).toEqual([
      'worktree',
      'add',
      path.join('/home/user', '.ai-yard', 'worktrees', 'proj-1', 'aiyard-x'),
      '-b',
      'aiyard/x',
      'main',
    ]);
  });

  it('propagates errors from git', async () => {
    simulateExecFile(new Error('fatal: branch already exists') as ExecFileException, '');
    await expect(createManagedWorktree('/repo', 'proj-1', 'existing', 'main')).rejects.toThrow();
  });
});

describe('removeManagedWorktree', () => {
  it('runs `git worktree remove <path> --force`', async () => {
    simulateExecFile(null, '');
    await removeManagedWorktree('/repo', '/path/to/worktree');
    expect(mockExecFile.mock.calls[0][1]).toEqual(['worktree', 'remove', '/path/to/worktree', '--force']);
  });
});

describe('deleteLocalBranch', () => {
  it('runs `git branch -D <branch>`', async () => {
    simulateExecFile(null, '');
    await deleteLocalBranch('/repo', 'aiyard/x');
    expect(mockExecFile.mock.calls[0][1]).toEqual(['branch', '-D', 'aiyard/x']);
  });
});

describe('localBranchExists', () => {
  it('returns true when rev-parse succeeds', async () => {
    simulateExecFile(null, 'abc123\n');
    expect(await localBranchExists('/repo', 'main')).toBe(true);
  });

  it('returns false when rev-parse errors (branch missing)', async () => {
    simulateExecFile(new Error('fatal: needed a single revision') as ExecFileException, '');
    expect(await localBranchExists('/repo', 'no-such-branch')).toBe(false);
  });
});
