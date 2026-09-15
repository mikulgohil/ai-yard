import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getGitStatus, gitCommit, gitFetch, gitPush } from './git-status';

/**
 * Real-git smoke of the daily-driver loop (no child_process mocks).
 * Proves commit + push + fetch against a local bare remote.
 */

let work: string | undefined;
let bare: string | undefined;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function makeRepo(): { work: string; bare: string } {
  work = mkdtempSync(path.join(tmpdir(), 'aiyard-loop-work-'));
  bare = mkdtempSync(path.join(tmpdir(), 'aiyard-loop-bare-'));
  git(bare, ['init', '--bare']);
  git(work, ['init', '-b', 'main']);
  git(work, ['config', 'user.email', 'loop@example.com']);
  git(work, ['config', 'user.name', 'Loop Test']);
  git(work, ['remote', 'add', 'origin', bare]);
  writeFileSync(path.join(work, 'README.md'), 'seed\n');
  git(work, ['add', 'README.md']);
  git(work, ['commit', '-m', 'chore: seed']);
  return { work, bare };
}

afterEach(() => {
  if (work) rmSync(work, { recursive: true, force: true });
  if (bare) rmSync(bare, { recursive: true, force: true });
  work = undefined;
  bare = undefined;
});

describe('git loop against a real repository', () => {
  it('commits a staged file and returns hash + subject', async () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo.work, 'note.txt'), 'hello\n');
    git(repo.work, ['add', 'note.txt']);

    const result = await gitCommit(repo.work, 'feat: add note', false);

    expect(result.subject).toBe('feat: add note');
    expect(result.hash).toMatch(/^[0-9a-f]{7,40}$/);
    const log = git(repo.work, ['log', '-1', '--format=%s']);
    expect(log.trim()).toBe('feat: add note');
  });

  it('rejects commit when nothing is staged', async () => {
    const repo = makeRepo();
    await expect(gitCommit(repo.work, 'feat: nope', false)).rejects.toThrow();
  });

  it('amends the last commit message', async () => {
    const repo = makeRepo();
    const result = await gitCommit(repo.work, 'chore: seed (amended)', true);
    expect(result.subject).toBe('chore: seed (amended)');
    const count = git(repo.work, ['rev-list', '--count', 'HEAD']).trim();
    expect(count).toBe('1');
  });

  it('pushes to a local origin then fetch reports clean', async () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo.work, 'note.txt'), 'hello\n');
    git(repo.work, ['add', 'note.txt']);
    await gitCommit(repo.work, 'feat: add note', false);

    const pushed = await gitPush(repo.work, { setUpstream: true, branch: 'main' });
    expect(pushed.ok).toBe(true);

    const fetched = await gitFetch(repo.work, 'origin');
    expect(fetched.ok).toBe(true);

    const status = await getGitStatus(repo.work);
    expect(status.branch).toBe('main');
    expect(status.ahead).toBe(0);
    expect(status.behind).toBe(0);
  });
});
