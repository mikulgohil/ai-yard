import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GITHUB_MAX_PER_PAGE } from '../shared/constants';
import type {
  CheckRun,
  GithubFetchResult,
  GithubItem,
  GithubRepo,
  PRComment,
  PRDetail,
  PRFile,
  RepoStats,
} from '../shared/types';
import { getGitRemoteUrl } from './git-status';
import { isWin, whichCmd } from './platform';
import { getFullPath } from './pty-manager';

let cachedAvailable: boolean | null = null;

function ghBinaryName(): string {
  return isWin ? 'gh.exe' : 'gh';
}

function ghCandidates(): string[] {
  const home = os.homedir();
  if (isWin) {
    return [
      path.join('C:\\Program Files\\GitHub CLI', 'gh.exe'),
      path.join(home, 'AppData', 'Local', 'Programs', 'GitHub CLI', 'gh.exe'),
      path.join(home, 'scoop', 'shims', 'gh.exe'),
      path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages', 'GitHub.cli_Microsoft.Winget.Source_8wekyb3d8bbwe', 'gh.exe'),
    ];
  }
  return [
    '/usr/local/bin/gh',
    '/opt/homebrew/bin/gh',
    '/usr/bin/gh',
    path.join(home, '.local', 'bin', 'gh'),
  ];
}

export function resetCacheForTesting(): void {
  cachedAvailable = null;
}

export async function isGhAvailable(): Promise<boolean> {
  if (cachedAvailable !== null) return cachedAvailable;

  for (const candidate of ghCandidates()) {
    try {
      if (fs.existsSync(candidate)) {
        cachedAvailable = true;
        return true;
      }
    } catch {}
  }

  try {
    const which = await new Promise<string>((resolve, reject) => {
      execFile(
        whichCmd,
        [ghBinaryName()],
        { env: { ...process.env, PATH: getFullPath() }, timeout: 3000 },
        (err, stdout) => (err ? reject(err) : resolve(stdout.trim())),
      );
    });
    cachedAvailable = !!which;
    return cachedAvailable;
  } catch {
    cachedAvailable = false;
    return false;
  }
}

interface GhApiOptions {
  query?: Record<string, string | number>;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: Record<string, unknown>;
}

async function ghApi<T = unknown>(apiPath: string, opts: GhApiOptions = {}): Promise<T> {
  const qs = opts.query
    ? `?${Object.entries(opts.query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}`
    : '';
  const fullPath = `${apiPath}${qs}`;
  const args = ['api', fullPath, '-H', 'Accept: application/vnd.github+json'];
  if (opts.method && opts.method !== 'GET') {
    args.push('-X', opts.method);
  }
  if (opts.body) {
    for (const [k, v] of Object.entries(opts.body)) {
      args.push('-f', `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
  }

  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      ghBinaryName(),
      args,
      {
        env: { ...process.env, PATH: getFullPath() },
        maxBuffer: 5 * 1024 * 1024,
        timeout: 15_000,
        windowsHide: true,
      },
      (err, out, errOut) => {
        if (err) {
          const msg = (errOut || err.message || '').toString().trim();
          reject(new Error(msg || 'gh api failed'));
          return;
        }
        resolve(out);
      },
    );
  });

  if (!stdout.trim()) return {} as T;
  return JSON.parse(stdout) as T;
}

export interface ListOptions {
  state: 'open' | 'closed' | 'all';
  max: number;
}

export async function listPullRequests(repo: string, opts: ListOptions): Promise<GithubFetchResult> {
  if (!repo?.includes('/')) return { ok: false, error: 'Invalid repo. Expected owner/name.' };
  if (!(await isGhAvailable())) return { ok: false, error: 'gh CLI not installed' };
  try {
    const items = await ghApi<GithubItem[]>(`repos/${repo}/pulls`, {
      query: { state: opts.state, per_page: Math.min(Math.max(opts.max, 1), GITHUB_MAX_PER_PAGE), sort: 'updated', direction: 'desc' },
    });
    return { ok: true, items: items.slice(0, opts.max) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function listIssues(repo: string, opts: ListOptions): Promise<GithubFetchResult> {
  if (!repo?.includes('/')) return { ok: false, error: 'Invalid repo. Expected owner/name.' };
  if (!(await isGhAvailable())) return { ok: false, error: 'gh CLI not installed' };
  try {
    // /issues endpoint returns PRs too — search API filters server-side via is:issue.
    const qParts = [`repo:${repo}`, 'is:issue'];
    if (opts.state !== 'all') qParts.push(`state:${opts.state}`);
    const perPage = Math.min(Math.max(opts.max, 1), GITHUB_MAX_PER_PAGE);
    const result = await ghApi<{ items: GithubItem[] }>('search/issues', {
      query: { q: qParts.join(' '), sort: 'updated', order: 'desc', per_page: perPage },
    });
    return { ok: true, items: result.items.slice(0, opts.max) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Parse owner/repo from a normalized GitHub HTTPS URL like https://github.com/owner/repo.
 * Returns null if the URL isn't recognized as github.com.
 */
export function parseGithubRepo(url: string | null): GithubRepo | null {
  if (!url) return null;
  const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

export async function detectRepo(projectPath: string): Promise<GithubRepo | null> {
  const url = await getGitRemoteUrl(projectPath);
  return parseGithubRepo(url);
}

// ---------------------------------------------------------------------------
// G13 — PR review
// ---------------------------------------------------------------------------

interface RawPR {
  number: number;
  title: string;
  body: string | null;
  base: { ref: string };
  head: { ref: string };
  user: { login: string };
  mergeable: boolean | null;
  state: 'open' | 'closed';
}

export async function getPrDetail(repo: string, prNumber: number): Promise<PRDetail> {
  const pr = await ghApi<RawPR>(`repos/${repo}/pulls/${prNumber}`);
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body || '',
    base: pr.base.ref,
    head: pr.head.ref,
    author: pr.user.login,
    mergeable: pr.mergeable,
    state: pr.state,
  };
}

export async function getPrFiles(repo: string, prNumber: number): Promise<PRFile[]> {
  const items = await ghApi<Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>>(
    `repos/${repo}/pulls/${prNumber}/files`,
    { query: { per_page: 100 } },
  );
  return items.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
  }));
}

export async function getPrComments(repo: string, prNumber: number): Promise<PRComment[]> {
  const items = await ghApi<Array<{ id: number; user: { login: string }; body: string; path?: string; line?: number; created_at: string }>>(
    `repos/${repo}/pulls/${prNumber}/comments`,
  );
  return items.map((c) => ({
    id: c.id,
    user: c.user.login,
    body: c.body,
    path: c.path,
    line: c.line,
    createdAt: c.created_at,
  }));
}

export async function submitPrReview(
  repo: string,
  prNumber: number,
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES',
  body: string,
): Promise<void> {
  await ghApi(`repos/${repo}/pulls/${prNumber}/reviews`, {
    method: 'POST',
    body: { event, body },
  });
}

export async function addPrComment(
  repo: string,
  prNumber: number,
  filePath: string,
  line: number,
  body: string,
): Promise<void> {
  await ghApi(`repos/${repo}/pulls/${prNumber}/comments`, {
    method: 'POST',
    body: { path: filePath, line, body, side: 'RIGHT' },
  });
}

// ---------------------------------------------------------------------------
// G16 — CI status
// ---------------------------------------------------------------------------

interface RawCheckRun {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: CheckRun['conclusion'];
  html_url: string;
  started_at: string;
  completed_at: string | null;
}

export async function getCiStatus(repo: string, ref: string): Promise<CheckRun[]> {
  try {
    const result = await ghApi<{ check_runs: RawCheckRun[] }>(
      `repos/${repo}/commits/${encodeURIComponent(ref)}/check-runs`,
    );
    return (result.check_runs || []).map((c) => ({
      name: c.name,
      status: c.status,
      conclusion: c.conclusion,
      htmlUrl: c.html_url,
      startedAt: c.started_at,
      completedAt: c.completed_at,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// G17 — Repository stats
// ---------------------------------------------------------------------------

interface RawRepo {
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  default_branch: string;
  pushed_at: string;
}

interface RawContributor {
  total: number;
  author: { login: string; avatar_url: string };
}

export async function getRepoStats(repo: string): Promise<RepoStats | null> {
  try {
    const [info, contributors, freq] = await Promise.all([
      ghApi<RawRepo>(`repos/${repo}`),
      ghApi<RawContributor[] | unknown>(`repos/${repo}/stats/contributors`).catch(() => []),
      ghApi<number[][]>(`repos/${repo}/stats/code_frequency`).catch(() => []),
    ]);

    const top = Array.isArray(contributors)
      ? (contributors as RawContributor[])
          .filter((c) => c?.author)
          .sort((a, b) => b.total - a.total)
          .slice(0, 5)
          .map((c) => ({
            login: c.author.login,
            avatarUrl: c.author.avatar_url,
            contributions: c.total,
          }))
      : [];

    const weekly = Array.isArray(freq)
      ? freq.slice(-12).map(([week, additions, deletions]) => ({
          week,
          additions,
          deletions: Math.abs(deletions),
        }))
      : [];

    return {
      stars: info.stargazers_count,
      forks: info.forks_count,
      openIssues: info.open_issues_count,
      language: info.language,
      defaultBranch: info.default_branch,
      pushedAt: info.pushed_at,
      contributors: top,
      weeklyActivity: weekly,
    };
  } catch {
    return null;
  }
}
