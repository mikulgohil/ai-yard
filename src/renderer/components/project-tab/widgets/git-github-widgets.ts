/**
 * G16 — CI/Actions status widget.
 * G17 — Repository stats widget.
 *
 * Both auto-detect the repo from the active project's git origin and refresh
 * on a configurable interval. They're additive; no shared state with the
 * existing PR/Issues widgets.
 */
import type { CheckRun, RepoStats } from '../../../../shared/types.js';
import { appState } from '../../../state.js';
import type { WidgetFactory, WidgetHost, WidgetInstance } from './widget-host.js';

const DEFAULT_REFRESH_SECONDS = 300;

interface GitHubWidgetConfig extends Record<string, unknown> {
  repo?: string;
  refreshSeconds?: number;
  ref?: string;
}

function escHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function resolveRepo(host: WidgetHost): Promise<string | null> {
  const cfg = host.getConfig<GitHubWidgetConfig>();
  if (cfg.repo?.includes('/')) return cfg.repo;
  const project = appState.projects.find((p) => p.id === host.projectId);
  if (!project) return null;
  const detected = await window.aiyard.github.detectRepo(project.path);
  return detected ? `${detected.owner}/${detected.repo}` : null;
}

async function resolveRef(host: WidgetHost): Promise<string> {
  const cfg = host.getConfig<GitHubWidgetConfig>();
  if (cfg.ref) return cfg.ref;
  const project = appState.projects.find((p) => p.id === host.projectId);
  if (!project) return 'HEAD';
  const status = (await window.aiyard.git.getStatus(project.path)) as { branch: string | null };
  return status?.branch || 'HEAD';
}

// ---------------------------------------------------------------------------
// G16 — CI status
// ---------------------------------------------------------------------------

export const createCiStatusWidget: WidgetFactory = (host) => {
  const root = document.createElement('div');
  root.className = 'widget-ci-status';
  let pollHandle: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  async function render(): Promise<void> {
    if (destroyed) return;
    root.innerHTML = '<div class="widget-empty">Loading…</div>';
    const repo = await resolveRepo(host);
    if (!repo) { root.innerHTML = '<div class="widget-empty">No GitHub repo detected.</div>'; return; }
    const ref = await resolveRef(host);
    const checks = (await window.aiyard.github.ciStatus(repo, ref)) as CheckRun[];
    if (checks.length === 0) {
      root.innerHTML = `<div class="widget-empty">No checks for <code>${escHtml(ref)}</code>.</div>`;
      return;
    }
    root.innerHTML = `
      <div class="widget-ci-header">${escHtml(repo)} · <code>${escHtml(ref)}</code></div>
      <div class="widget-ci-list"></div>
    `;
    const list = root.querySelector('.widget-ci-list') as HTMLElement;
    for (const c of checks) {
      const symbol = symbolFor(c);
      const row = document.createElement('div');
      row.className = `widget-ci-row ${cssFor(c)}`;
      row.innerHTML = `
        <span class="widget-ci-symbol">${symbol}</span>
        <span class="widget-ci-name">${escHtml(c.name)}</span>
        <a class="widget-ci-link" href="${c.htmlUrl}">View</a>
      `;
      const a = row.querySelector('.widget-ci-link') as HTMLAnchorElement;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        void window.aiyard.app.openExternal(c.htmlUrl);
      });
      list.appendChild(row);
    }
  }

  function symbolFor(c: CheckRun): string {
    if (c.status !== 'completed') return '⟳';
    switch (c.conclusion) {
      case 'success': return '✓';
      case 'failure': return '✗';
      case 'cancelled': return '⊘';
      case 'skipped': return '○';
      default: return '?';
    }
  }
  function cssFor(c: CheckRun): string {
    if (c.status !== 'completed') return 'running';
    return c.conclusion || 'unknown';
  }

  function startPolling(): void {
    const cfg = host.getConfig<GitHubWidgetConfig>();
    const interval = (cfg.refreshSeconds ?? DEFAULT_REFRESH_SECONDS) * 1000;
    pollHandle = setTimeout(async () => {
      await render();
      startPolling();
    }, interval);
  }

  void render();
  startPolling();

  return {
    element: root,
    destroy(): void {
      destroyed = true;
      if (pollHandle) clearTimeout(pollHandle);
    },
    refresh(): void {
      void render();
    },
  };
};

// ---------------------------------------------------------------------------
// G17 — Repo stats
// ---------------------------------------------------------------------------

export const createRepoStatsWidget: WidgetFactory = (host) => {
  const root = document.createElement('div');
  root.className = 'widget-repo-stats';
  let pollHandle: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  async function render(): Promise<void> {
    if (destroyed) return;
    root.innerHTML = '<div class="widget-empty">Loading…</div>';
    const repo = await resolveRepo(host);
    if (!repo) { root.innerHTML = '<div class="widget-empty">No GitHub repo detected.</div>'; return; }
    const stats = (await window.aiyard.github.repoStats(repo)) as RepoStats | null;
    if (!stats) {
      root.innerHTML = '<div class="widget-empty">Failed to load stats.</div>';
      return;
    }
    const lastPushDays = Math.max(0, Math.floor((Date.now() - new Date(stats.pushedAt).getTime()) / 86_400_000));
    root.innerHTML = `
      <div class="widget-repo-row1">
        <span class="chip">★ ${stats.stars}</span>
        <span class="chip">⑂ ${stats.forks}</span>
        <span class="chip">⚠ ${stats.openIssues}</span>
        ${stats.language ? `<span class="chip">${escHtml(stats.language)}</span>` : ''}
      </div>
      <div class="widget-repo-row2">Last push ${lastPushDays}d ago · default branch <code>${escHtml(stats.defaultBranch)}</code></div>
      <div class="widget-repo-spark">${sparkSvg(stats.weeklyActivity)}</div>
      <div class="widget-repo-contribs">
        ${stats.contributors.slice(0, 3).map((c) => `
          <div class="contrib-row">
            <img src="${escHtml(c.avatarUrl)}" alt="${escHtml(c.login)}" />
            <span>${escHtml(c.login)}</span>
            <span class="contrib-count">${c.contributions} commits</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function sparkSvg(weekly: RepoStats['weeklyActivity']): string {
    if (!weekly?.length) return '<em>No activity data.</em>';
    const max = Math.max(1, ...weekly.map((w) => w.additions + w.deletions));
    const W = 220;
    const H = 40;
    const bw = W / weekly.length;
    return `<svg width="${W}" height="${H}" aria-label="Weekly activity">
      ${weekly.map((w, i) => {
        const addH = (w.additions / max) * (H * 0.7);
        const delH = (w.deletions / max) * (H * 0.7);
        const x = i * bw;
        return `
          <rect x="${x}" y="${H - addH}" width="${bw - 1}" height="${addH}" fill="#34c759"/>
          <rect x="${x}" y="${H - addH - delH}" width="${bw - 1}" height="${delH}" fill="#ff3b30" opacity="0.7"/>
        `;
      }).join('')}
    </svg>`;
  }

  function startPolling(): void {
    const cfg = host.getConfig<GitHubWidgetConfig>();
    const interval = (cfg.refreshSeconds ?? DEFAULT_REFRESH_SECONDS) * 1000;
    pollHandle = setTimeout(async () => {
      await render();
      startPolling();
    }, interval);
  }

  void render();
  startPolling();

  return {
    element: root,
    destroy(): void {
      destroyed = true;
      if (pollHandle) clearTimeout(pollHandle);
    },
    refresh(): void {
      void render();
    },
  };
};

export type WidgetInstanceShape = WidgetInstance;
