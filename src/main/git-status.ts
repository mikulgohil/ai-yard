import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  BlameEntry,
  BranchCompareResult,
  CommitEntry,
  ConflictedFile,
  GitFileEntry,
  GitWorktree,
  GrepMatch,
  PickaxeMatch,
  RebaseTodo,
  ReflogEntry,
  StashEntry,
  SubmoduleEntry,
  TagEntry,
} from '../shared/types';

export type { GitFileEntry, GitWorktree } from '../shared/types';

export interface GitStatus {
  isGitRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
}

const NOT_A_REPO: GitStatus = {
  isGitRepo: false,
  branch: null,
  ahead: 0,
  behind: 0,
  staged: 0,
  modified: 0,
  untracked: 0,
  conflicted: 0,
};

export function getGitStatus(cwd: string): Promise<GitStatus> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['status', '--porcelain=v2', '--branch', '--untracked-files=all'],
      { cwd, timeout: 5000 },
      (err, stdout) => {
        if (err) {
          resolve(NOT_A_REPO);
          return;
        }

        let branch: string | null = null;
        let ahead = 0;
        let behind = 0;
        let staged = 0;
        let modified = 0;
        let untracked = 0;
        let conflicted = 0;

        for (const line of stdout.split('\n')) {
          if (line.startsWith('# branch.head ')) {
            branch = line.slice('# branch.head '.length);
          } else if (line.startsWith('# branch.ab ')) {
            const match = line.match(/\+(\d+) -(\d+)/);
            if (match) {
              ahead = parseInt(match[1], 10);
              behind = parseInt(match[2], 10);
            }
          } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
            // Ordinary/rename entries: XY field is at index 2 (after the type char and space)
            const xy = line.split(' ')[1];
            if (xy && xy.length >= 2) {
              const x = xy[0]; // staged
              const y = xy[1]; // working tree
              if (x !== '.') staged++;
              if (y !== '.') modified++;
            }
          } else if (line.startsWith('u ')) {
            conflicted++;
          } else if (line.startsWith('? ')) {
            untracked++;
          }
        }

        resolve({
          isGitRepo: true,
          branch,
          ahead,
          behind,
          staged,
          modified,
          untracked,
          conflicted,
        });
      }
    );
  });
}

export function getGitDiff(cwd: string, filePath: string, area: string): Promise<string> {
  return new Promise((resolve) => {
    if (area === 'untracked') {
      // Read file content and format as "all added" diff
      const fullPath = path.join(cwd, filePath);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        const header = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n`;
        const body = lines.map(l => `+${l}`).join('\n');
        resolve(header + body);
      } catch {
        resolve('(unable to read file)');
      }
      return;
    }

    const args = area === 'staged'
      ? ['diff', '--cached', '--', filePath]
      : ['diff', '--', filePath];

    execFile(
      'git',
      args,
      { cwd, timeout: 10000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) {
          resolve('(no diff available)');
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function xyToStatus(ch: string): 'added' | 'modified' | 'deleted' | 'renamed' {
  switch (ch) {
    case 'A': return 'added';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    default: return 'modified';
  }
}

export function getGitFiles(cwd: string): Promise<GitFileEntry[]> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['status', '--porcelain=v2', '--untracked-files=all'],
      { cwd, timeout: 5000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }

        const entries: GitFileEntry[] = [];

        for (const line of stdout.split('\n')) {
          if (line.startsWith('1 ') || line.startsWith('2 ')) {
            // Ordinary (1) or rename (2) entry
            const parts = line.split('\t');
            const fields = parts[0].split(' ');
            const xy = fields[1];
            // For type 1: path is last space-delimited field
            // For type 2: path is the second tab-delimited field (new name)
            const path = line.startsWith('2 ') && parts.length >= 2
              ? parts[parts.length - 1]
              : fields[fields.length - 1];

            if (xy && xy.length >= 2) {
              const x = xy[0]; // staged
              const y = xy[1]; // working tree
              if (x !== '.') {
                entries.push({ path, status: xyToStatus(x), area: 'staged' });
              }
              if (y !== '.') {
                entries.push({ path, status: xyToStatus(y), area: 'working' });
              }
            }
          } else if (line.startsWith('u ')) {
            // Unmerged entry
            const parts = line.split('\t');
            const path = parts.length >= 2 ? parts[parts.length - 1] : line.split(' ').pop()!;
            entries.push({ path, status: 'conflicted', area: 'conflicted' });
          } else if (line.startsWith('? ')) {
            const path = line.slice(2);
            entries.push({ path, status: 'untracked', area: 'untracked' });
          }
        }

        resolve(entries);
      }
    );
  });
}

function execGit(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 5000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function execGitWithOutput(cwd: string, args: string[], timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export async function listGitBranches(cwd: string): Promise<GitBranch[]> {
  const stdout = await execGitWithOutput(cwd, ['branch', '--list']);
  const branches: GitBranch[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    const current = trimmed.startsWith('* ');
    const name = trimmed.slice(2);
    // Skip detached HEAD entries like "(HEAD detached at ...)"
    if (name.startsWith('(')) continue;
    branches.push({ name, current });
  }
  return branches;
}

export async function checkoutGitBranch(cwd: string, branch: string): Promise<void> {
  await execGit(cwd, ['checkout', branch]);
}

export async function createGitBranch(cwd: string, branch: string): Promise<void> {
  await execGit(cwd, ['checkout', '-b', branch]);
}

export function gitStageFile(cwd: string, filePath: string): Promise<void> {
  return execGit(cwd, ['add', '--', filePath]);
}

export function gitUnstageFile(cwd: string, filePath: string): Promise<void> {
  return execGit(cwd, ['reset', 'HEAD', '--', filePath]);
}

export function gitDiscardFile(cwd: string, filePath: string, area: GitFileEntry['area']): Promise<void> {
  if (area === 'untracked') {
    const fullPath = path.join(cwd, filePath);
    return fs.promises.rm(fullPath, { recursive: true, force: true });
  }
  return execGit(cwd, ['checkout', '--', filePath]);
}

export function getGitWorktrees(cwd: string): Promise<GitWorktree[]> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['worktree', 'list', '--porcelain'],
      { cwd, timeout: 5000 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }

        const worktrees: GitWorktree[] = [];
        const blocks = stdout.split('\n\n');

        for (const block of blocks) {
          const lines = block.trim().split('\n');
          if (lines.length === 0 || !lines[0]) continue;

          let path = '';
          let head = '';
          let branch: string | null = null;
          let isBare = false;

          for (const line of lines) {
            if (line.startsWith('worktree ')) {
              path = line.slice('worktree '.length);
            } else if (line.startsWith('HEAD ')) {
              head = line.slice('HEAD '.length);
            } else if (line.startsWith('branch ')) {
              const ref = line.slice('branch '.length);
              branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
            } else if (line === 'bare') {
              isBare = true;
            } else if (line === 'detached') {
              branch = null;
            }
          }

          if (path) {
            worktrees.push({ path, head, branch, isBare });
          }
        }

        resolve(worktrees);
      }
    );
  });
}

export function getGitRemoteUrl(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['remote', 'get-url', 'origin'], { cwd }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const raw = stdout.trim();
      // Normalize SSH (git@github.com:owner/repo.git) to HTTPS
      const ssh = raw.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
      if (ssh) { resolve(`https://${ssh[1]}/${ssh[2]}`); return; }
      // Strip trailing .git from HTTPS URLs
      resolve(raw.replace(/\.git$/, '') || null);
    });
  });
}

// ---------------------------------------------------------------------------
// G1 — Commit creation
// ---------------------------------------------------------------------------

const COMMIT_TIMEOUT_MS = 60_000;

export async function gitCommit(cwd: string, message: string, amend: boolean): Promise<{ hash: string; subject: string }> {
  const args = ['commit', '-m', message];
  if (amend) args.push('--amend');
  // Hooks (lint-staged, tests) routinely exceed the default 5s exec timeout.
  await execGitWithOutput(cwd, args, COMMIT_TIMEOUT_MS);
  const log = await execGitWithOutput(cwd, ['log', '-1', '--format=%h%n%s']);
  const [hash, subject] = log.split('\n');
  return { hash: hash.trim(), subject: (subject || '').trim() };
}

export async function getLastCommitMessage(cwd: string): Promise<{ subject: string; body: string }> {
  const out = await execGitWithOutput(cwd, ['log', '-1', '--format=%s%n%n%b']);
  const lines = out.split('\n');
  const subject = lines[0] || '';
  const body = lines.slice(2).join('\n').trimEnd();
  return { subject, body };
}

// ---------------------------------------------------------------------------
// G2 — Push / pull / fetch (streaming via spawn for progress)
// ---------------------------------------------------------------------------

export interface RemoteOpResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function gitFetch(cwd: string, remote = 'origin'): Promise<RemoteOpResult> {
  return spawnGit(cwd, ['fetch', remote, '--prune']);
}

export function gitPull(cwd: string, rebase: boolean): Promise<RemoteOpResult> {
  return spawnGit(cwd, rebase ? ['pull', '--rebase'] : ['pull']);
}

export function gitPush(
  cwd: string,
  opts: { setUpstream?: boolean; force?: boolean; branch?: string },
): Promise<RemoteOpResult> {
  const args: string[] = ['push'];
  if (opts.force) args.push('--force-with-lease');
  if (opts.setUpstream) {
    args.push('-u', 'origin');
    if (opts.branch) args.push(opts.branch);
  }
  return spawnGit(cwd, args);
}

const REMOTE_TIMEOUT_MS = 120_000;

function spawnGit(cwd: string, args: string[], timeoutMs = REMOTE_TIMEOUT_MS): Promise<RemoteOpResult> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: RemoteOpResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      finish({
        ok: false,
        stdout,
        stderr: stderr || `git ${args[0] ?? 'command'} timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      finish({ ok: code === 0, stdout, stderr });
    });
    proc.on('error', (err) => {
      finish({ ok: false, stdout, stderr: err.message });
    });
  });
}

// ---------------------------------------------------------------------------
// G3 — Hunk staging via temp patch file
// ---------------------------------------------------------------------------

export async function gitStageHunk(cwd: string, patch: string): Promise<void> {
  await applyPatch(cwd, patch, false);
}

export async function gitUnstageHunk(cwd: string, patch: string): Promise<void> {
  await applyPatch(cwd, patch, true);
}

async function applyPatch(cwd: string, patch: string, reverse: boolean): Promise<void> {
  const file = path.join(os.tmpdir(), `aiyard-patch-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`);
  await fs.promises.writeFile(file, patch);
  try {
    const args = ['apply', '--cached', '--whitespace=fix'];
    if (reverse) args.push('--reverse');
    args.push(file);
    await execGitWithOutput(cwd, args);
  } finally {
    await fs.promises.rm(file, { force: true });
  }
}

// ---------------------------------------------------------------------------
// G4 — Stash
// ---------------------------------------------------------------------------

export async function gitStashList(cwd: string): Promise<StashEntry[]> {
  const out = await execGitWithOutput(cwd, ['stash', 'list', '--format=%gd|%s|%ci']);
  const entries: StashEntry[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [ref, message, date] = line.split('|');
    entries.push({ ref, message: message || '', date: date || '' });
  }
  return entries;
}

export async function gitStashPush(cwd: string, message?: string, includeUntracked = false): Promise<void> {
  const args = ['stash', 'push'];
  if (includeUntracked) args.push('-u');
  if (message) args.push('-m', message);
  await execGitWithOutput(cwd, args);
}

export async function gitStashPop(cwd: string, ref?: string): Promise<void> {
  const args = ['stash', 'pop'];
  if (ref) args.push(ref);
  await execGitWithOutput(cwd, args);
}

export async function gitStashApply(cwd: string, ref: string): Promise<void> {
  await execGitWithOutput(cwd, ['stash', 'apply', ref]);
}

export async function gitStashDrop(cwd: string, ref: string): Promise<void> {
  await execGitWithOutput(cwd, ['stash', 'drop', ref]);
}

export async function gitStashShow(cwd: string, ref: string): Promise<string> {
  return execGitWithOutput(cwd, ['stash', 'show', '-p', ref]);
}

// ---------------------------------------------------------------------------
// G5 — Commit history graph
// ---------------------------------------------------------------------------

export async function gitLog(
  cwd: string,
  opts: { branch?: string; limit?: number; skip?: number; filePath?: string } = {},
): Promise<CommitEntry[]> {
  const args = ['log', `--max-count=${opts.limit ?? 100}`, '--format=%H|%P|%s|%an|%ae|%ci|%D'];
  if (opts.skip) args.push(`--skip=${opts.skip}`);
  if (opts.branch) args.push(opts.branch);
  if (opts.filePath) args.push('--', opts.filePath);
  const out = await execGitWithOutput(cwd, args);
  const entries: CommitEntry[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [hash, parents, subject, author, email, date, refs] = line.split('|');
    entries.push({
      hash,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      subject: subject || '',
      author: author || '',
      email: email || '',
      date: date || '',
      refs: refs ? refs.split(', ').filter(Boolean) : [],
    });
  }
  return entries;
}

export async function gitShowCommit(cwd: string, hash: string): Promise<string> {
  return execGitWithOutput(cwd, ['show', '--stat', '--patch', hash]);
}

// ---------------------------------------------------------------------------
// G6 — Blame
// ---------------------------------------------------------------------------

export async function gitBlame(cwd: string, filePath: string): Promise<BlameEntry[]> {
  const out = await execGitWithOutput(cwd, ['blame', '--porcelain', '--', filePath]);
  const entries: BlameEntry[] = [];
  const meta = new Map<string, Partial<BlameEntry>>();
  let currentHash: string | null = null;
  let lineNumber = 0;
  for (const rawLine of out.split('\n')) {
    if (/^[0-9a-f]{40} /.test(rawLine)) {
      const parts = rawLine.split(' ');
      currentHash = parts[0];
      lineNumber = parseInt(parts[2] || '0', 10);
      if (!meta.has(currentHash)) meta.set(currentHash, { hash: currentHash });
    } else if (rawLine.startsWith('\t') && currentHash) {
      const m = meta.get(currentHash) || { hash: currentHash };
      entries.push({
        hash: currentHash,
        author: m.author || '',
        email: m.email || '',
        date: m.date || '',
        summary: m.summary || '',
        lineNumber,
        lineContent: rawLine.slice(1),
      });
    } else if (currentHash) {
      const m = meta.get(currentHash) || { hash: currentHash };
      if (rawLine.startsWith('author ')) m.author = rawLine.slice('author '.length);
      else if (rawLine.startsWith('author-mail ')) m.email = rawLine.slice('author-mail '.length).replace(/[<>]/g, '');
      else if (rawLine.startsWith('author-time ')) {
        const ts = parseInt(rawLine.slice('author-time '.length), 10);
        m.date = new Date(ts * 1000).toISOString();
      } else if (rawLine.startsWith('summary ')) m.summary = rawLine.slice('summary '.length);
      meta.set(currentHash, m);
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// G7 — Tags
// ---------------------------------------------------------------------------

export async function gitListTags(cwd: string): Promise<TagEntry[]> {
  const out = await execGitWithOutput(cwd, [
    'tag', '--list', '--sort=-version:refname',
    '--format=%(refname:short)|%(objectname:short)|%(creatordate:short)|%(subject)',
  ]);
  const entries: TagEntry[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [name, hash, date, subject] = line.split('|');
    entries.push({ name, hash: hash || '', date: date || '', subject: subject || '' });
  }
  return entries;
}

export async function gitCreateTag(cwd: string, name: string, message?: string, ref?: string): Promise<void> {
  const args = ['tag'];
  if (message) {
    args.push('-a', name, '-m', message);
  } else {
    args.push(name);
  }
  if (ref) args.push(ref);
  await execGitWithOutput(cwd, args);
}

export async function gitDeleteTag(cwd: string, name: string): Promise<void> {
  await execGitWithOutput(cwd, ['tag', '-d', name]);
}

export async function gitPushTag(cwd: string, name: string): Promise<RemoteOpResult> {
  return spawnGit(cwd, ['push', 'origin', name]);
}

export async function gitPushAllTags(cwd: string): Promise<RemoteOpResult> {
  return spawnGit(cwd, ['push', 'origin', '--tags']);
}

// ---------------------------------------------------------------------------
// G8 — Reflog
// ---------------------------------------------------------------------------

export async function gitReflog(cwd: string, limit = 50): Promise<ReflogEntry[]> {
  const out = await execGitWithOutput(cwd, ['reflog', `--max-count=${limit}`, '--format=%gd|%H|%gs|%ci']);
  const entries: ReflogEntry[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [ref, hash, action, date] = line.split('|');
    entries.push({ ref, hash: hash || '', action: action || '', date: date || '' });
  }
  return entries;
}

export async function gitResetTo(cwd: string, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
  await execGitWithOutput(cwd, ['reset', `--${mode}`, hash]);
}

export async function gitCreateBranchAt(cwd: string, branch: string, hash: string): Promise<void> {
  await execGitWithOutput(cwd, ['branch', branch, hash]);
}

export async function gitCheckoutHash(cwd: string, hash: string): Promise<void> {
  await execGitWithOutput(cwd, ['checkout', hash]);
}

// ---------------------------------------------------------------------------
// G9 — Branch comparison
// ---------------------------------------------------------------------------

export async function gitCompareBranches(cwd: string, base: string, head: string): Promise<BranchCompareResult> {
  const [statusOut, logOut, numstatOut] = await Promise.all([
    execGitWithOutput(cwd, ['diff', '--name-status', `${base}...${head}`]),
    execGitWithOutput(cwd, ['log', `${base}..${head}`, '--format=%H|%s|%an|%ci']),
    execGitWithOutput(cwd, ['diff', '--numstat', `${base}...${head}`]),
  ]);

  const numstats = new Map<string, { additions: number; deletions: number }>();
  for (const line of numstatOut.split('\n')) {
    if (!line.trim()) continue;
    const [add, del, ...rest] = line.split('\t');
    numstats.set(rest.join('\t'), {
      additions: parseInt(add, 10) || 0,
      deletions: parseInt(del, 10) || 0,
    });
  }

  const files: BranchCompareResult['files'] = [];
  for (const line of statusOut.split('\n')) {
    if (!line.trim()) continue;
    const [letter, ...rest] = line.split('\t');
    const filePath = rest.join('\t');
    let status: 'added' | 'modified' | 'deleted' | 'renamed' = 'modified';
    if (letter.startsWith('A')) status = 'added';
    else if (letter.startsWith('D')) status = 'deleted';
    else if (letter.startsWith('R')) status = 'renamed';
    const stats = numstats.get(filePath) || { additions: 0, deletions: 0 };
    files.push({ path: filePath, status, additions: stats.additions, deletions: stats.deletions });
  }

  const commits: BranchCompareResult['commits'] = [];
  for (const line of logOut.split('\n')) {
    if (!line.trim()) continue;
    const [hash, subject, author, date] = line.split('|');
    commits.push({ hash, subject: subject || '', author: author || '', date: date || '' });
  }

  return { files, commits };
}

export async function getDefaultBranch(cwd: string): Promise<string> {
  try {
    const out = await execGitWithOutput(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    return out.trim().replace(/^origin\//, '') || 'main';
  } catch {
    return 'main';
  }
}

// ---------------------------------------------------------------------------
// G10 — Conflict resolver
// ---------------------------------------------------------------------------

export async function getConflictedFile(cwd: string, filePath: string): Promise<ConflictedFile> {
  const fullPath = path.join(cwd, filePath);
  const [current, base, ours, theirs] = await Promise.all([
    fs.promises.readFile(fullPath, 'utf-8').catch(() => ''),
    execGitWithOutput(cwd, ['show', `:1:${filePath}`]).catch(() => ''),
    execGitWithOutput(cwd, ['show', `:2:${filePath}`]).catch(() => ''),
    execGitWithOutput(cwd, ['show', `:3:${filePath}`]).catch(() => ''),
  ]);
  return { current, base, ours, theirs };
}

export async function resolveConflict(cwd: string, filePath: string, resolvedContent: string): Promise<void> {
  const fullPath = path.join(cwd, filePath);
  await fs.promises.writeFile(fullPath, resolvedContent);
  await gitStageFile(cwd, filePath);
}

// ---------------------------------------------------------------------------
// G15 — Bisect
// ---------------------------------------------------------------------------

export async function gitBisectStart(cwd: string, bad?: string, good?: string): Promise<string> {
  const args = ['bisect', 'start'];
  if (bad) args.push(bad);
  if (good) args.push(good);
  return execGitWithOutput(cwd, args);
}

export async function gitBisectGood(cwd: string, commit?: string): Promise<string> {
  const args = ['bisect', 'good'];
  if (commit) args.push(commit);
  return execGitWithOutput(cwd, args);
}

export async function gitBisectBad(cwd: string, commit?: string): Promise<string> {
  const args = ['bisect', 'bad'];
  if (commit) args.push(commit);
  return execGitWithOutput(cwd, args);
}

export async function gitBisectReset(cwd: string): Promise<void> {
  await execGitWithOutput(cwd, ['bisect', 'reset']);
}

export function gitBisectRun(cwd: string, command: string): Promise<RemoteOpResult> {
  const parts = command.split(/\s+/).filter(Boolean);
  return spawnGit(cwd, ['bisect', 'run', ...parts]);
}

// ---------------------------------------------------------------------------
// G18 — Code search across history
// ---------------------------------------------------------------------------

export async function gitPickaxe(cwd: string, query: string, limit = 20): Promise<PickaxeMatch[]> {
  const out = await execGitWithOutput(cwd, [
    'log', `-S${query}`, `--max-count=${limit}`, '--format=%H|%s|%an|%ci',
  ]);
  const matches: PickaxeMatch[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [hash, subject, author, date] = line.split('|');
    matches.push({ hash, subject: subject || '', author: author || '', date: date || '' });
  }
  return matches;
}

export async function gitGrep(cwd: string, query: string, ref?: string): Promise<GrepMatch[]> {
  const args = ['grep', '-n', '--no-color', query];
  if (ref) args.push(ref);
  try {
    const out = await execGitWithOutput(cwd, args);
    const matches: GrepMatch[] = [];
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const m = line.match(/^([^:]+):(\d+):(.*)$/);
      if (m) matches.push({ path: m[1], line: parseInt(m[2], 10), content: m[3] });
    }
    return matches;
  } catch {
    return [];
  }
}

export async function gitLogGrep(cwd: string, pattern: string, limit = 20): Promise<PickaxeMatch[]> {
  const out = await execGitWithOutput(cwd, [
    'log', `--grep=${pattern}`, `--max-count=${limit}`, '--format=%H|%s|%an|%ci',
  ]);
  const matches: PickaxeMatch[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [hash, subject, author, date] = line.split('|');
    matches.push({ hash, subject: subject || '', author: author || '', date: date || '' });
  }
  return matches;
}

// ---------------------------------------------------------------------------
// G19 — Interactive rebase
// ---------------------------------------------------------------------------

export async function gitRebaseInteractiveTodo(cwd: string, base: string): Promise<RebaseTodo[]> {
  const commits = await gitLog(cwd, { branch: `${base}..HEAD`, limit: 200 });
  return commits.reverse().map((c) => ({ action: 'pick', hash: c.hash, subject: c.subject }));
}

export async function gitRebaseApply(cwd: string, base: string, todos: RebaseTodo[]): Promise<RemoteOpResult> {
  const todoFile = path.join(os.tmpdir(), `aiyard-rebase-${Date.now()}.txt`);
  await fs.promises.writeFile(
    todoFile,
    `${todos.map((t) => `${t.action} ${t.hash} ${t.subject}`).join('\n')}\n`,
  );
  return new Promise((resolve) => {
    const proc = spawn('git', ['rebase', '-i', base], {
      cwd,
      env: { ...process.env, GIT_SEQUENCE_EDITOR: `cp ${todoFile}` },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      void fs.promises.rm(todoFile, { force: true });
      resolve({ ok: code === 0, stdout, stderr });
    });
    proc.on('error', (err) => {
      void fs.promises.rm(todoFile, { force: true });
      resolve({ ok: false, stdout, stderr: err.message });
    });
  });
}

export async function gitRebaseContinue(cwd: string): Promise<RemoteOpResult> {
  return spawnGit(cwd, ['rebase', '--continue']);
}

export async function gitRebaseAbort(cwd: string): Promise<void> {
  await execGitWithOutput(cwd, ['rebase', '--abort']);
}

// ---------------------------------------------------------------------------
// G20 — Cherry-pick
// ---------------------------------------------------------------------------

export async function gitCherryPick(cwd: string, hash: string, noCommit = false): Promise<RemoteOpResult> {
  const args = ['cherry-pick'];
  if (noCommit) args.push('-n');
  args.push(hash);
  return spawnGit(cwd, args);
}

export async function gitCherryPickContinue(cwd: string): Promise<RemoteOpResult> {
  return spawnGit(cwd, ['cherry-pick', '--continue']);
}

export async function gitCherryPickAbort(cwd: string): Promise<void> {
  await execGitWithOutput(cwd, ['cherry-pick', '--abort']);
}

// ---------------------------------------------------------------------------
// G21 — Submodules
// ---------------------------------------------------------------------------

export async function gitSubmoduleList(cwd: string): Promise<SubmoduleEntry[]> {
  try {
    const out = await execGitWithOutput(cwd, ['submodule', 'status', '--recursive']);
    const entries: SubmoduleEntry[] = [];
    for (const line of out.split('\n')) {
      if (!line) continue;
      const prefix = line[0];
      const rest = line.slice(1).trim();
      const parts = rest.split(' ');
      const hash = parts[0] || '';
      const subPath = parts[1] || '';
      const name = subPath.split('/').pop() || subPath;
      let status: SubmoduleEntry['status'] = 'initialized';
      if (prefix === '-') status = 'uninitialized';
      else if (prefix === '+') status = 'modified';
      else if (prefix === 'U') status = 'conflict';
      entries.push({ path: subPath, hash, name, status });
    }
    return entries;
  } catch {
    return [];
  }
}

export async function gitSubmoduleUpdate(cwd: string, recursive = true): Promise<RemoteOpResult> {
  const args = ['submodule', 'update', '--init'];
  if (recursive) args.push('--recursive');
  return spawnGit(cwd, args);
}

export async function gitSubmoduleSync(cwd: string): Promise<void> {
  await execGitWithOutput(cwd, ['submodule', 'sync', '--recursive']);
}

// ---------------------------------------------------------------------------
// Worktree management — AI-yard creates per-session worktrees under
// ~/.ai-yard/worktrees/<projectId>/<slug>/ so multiple AI sessions can run on
// the same repo without colliding.
// ---------------------------------------------------------------------------

/**
 * Sanitize a branch name into a filesystem-safe directory slug. Branches like
 * "aiyard/fix-login-bug" turn into "aiyard-fix-login-bug" because '/' is
 * legal in git refs but illegal in a single dirname.
 */
export function slugifyForFs(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'worktree';
}

/** Resolve the on-disk path AI-yard uses for a managed worktree. */
export function getManagedWorktreePath(projectId: string, branch: string): string {
  return path.join(os.homedir(), '.ai-yard', 'worktrees', projectId, slugifyForFs(branch));
}

/**
 * Create a new worktree on a NEW branch under the AI-yard managed directory.
 * Throws if the branch already exists or `git worktree add` fails.
 */
export async function createManagedWorktree(
  projectPath: string,
  projectId: string,
  branch: string,
  baseBranch: string,
): Promise<{ path: string }> {
  const dest = getManagedWorktreePath(projectId, branch);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await execGitWithOutput(projectPath, ['worktree', 'add', dest, '-b', branch, baseBranch]);
  return { path: dest };
}

/**
 * Remove a worktree directory. Uses --force so worktrees with uncommitted
 * changes can still be cleaned up — the calling UI is expected to confirm
 * with the user before invoking this.
 */
export async function removeManagedWorktree(projectPath: string, worktreePath: string): Promise<void> {
  await execGitWithOutput(projectPath, ['worktree', 'remove', worktreePath, '--force']);
}

/** Force-delete a local branch (the `-D` form so unmerged branches still go). */
export async function deleteLocalBranch(projectPath: string, branch: string): Promise<void> {
  await execGitWithOutput(projectPath, ['branch', '-D', branch]);
}

/** True if the given branch already exists locally. */
export async function localBranchExists(projectPath: string, branch: string): Promise<boolean> {
  try {
    await execGitWithOutput(projectPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}
