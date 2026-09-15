/**
 * Git actions panel. Augments the file-list git panel with the daily-driver loop.
 * See docs/GIT_FEATURES.md.
 *
 * Primary toolbar: fetch / pull / push / history / compare (extras under More).
 * Also: commit area (G1, G11), stash (G4), tags (G7), reflog (G8), submodules (G21).
 *
 * Mount point: #git-actions-panel in the sidebar (below #git-panel).
 */
import { canCommit } from '../../shared/git-loop.js';
import { getActiveGitPath } from '../git-status.js';
import { appState } from '../state.js';
import type {
  ConflictedFile,
  RebaseTodo,
  ReflogEntry,
  StashEntry,
  SubmoduleEntry,
  TagEntry,
} from '../types.js';
import { showCommitHistory } from './git-history-pane.js';
import { showBisectWizard, showBranchCompareModal, showConflictResolver, showHistorySearchModal, showRebaseModal } from './git-modals.js';
import { closeModal, showConfirmModal, showModal } from './modal.js';

const REFRESH_THROTTLE_MS = 1000;

let mountedFor: string | null = null;
let lastRefresh = 0;
let unsubscribeGitChanged: (() => void) | null = null;

interface GitMeta {
  branch: string | null;
  ahead: number;
  behind: number;
  conflicted: number;
  staged: number;
}

export function initGitActionsPanel(): void {
  appState.on('project-changed', refresh);
  appState.on('state-loaded', refresh);
  if (window.aiyard?.git?.onChanged) {
    unsubscribeGitChanged = window.aiyard.git.onChanged(() => {
      const now = Date.now();
      if (now - lastRefresh < REFRESH_THROTTLE_MS) return;
      lastRefresh = now;
      refresh();
    });
  }
}

export function disposeGitActionsPanel(): void {
  unsubscribeGitChanged?.();
  unsubscribeGitChanged = null;
}

async function refresh(): Promise<void> {
  const container = document.getElementById('git-actions-panel');
  if (!container) return;
  const project = appState.activeProject;
  if (!project) {
    container.innerHTML = '';
    mountedFor = null;
    return;
  }
  const gitPath = getActiveGitPath(project.id);
  const status = (await window.aiyard.git.getStatus(gitPath)) as GitMeta & { isGitRepo: boolean };
  if (!status?.isGitRepo) {
    container.innerHTML = '';
    mountedFor = null;
    return;
  }

  if (mountedFor !== gitPath) {
    container.innerHTML = '';
    mountedFor = gitPath;
  }

  renderToolbar(container, gitPath, status);
  renderCommitArea(container, gitPath, status);
  if (status.conflicted > 0) {
    renderConflictBanner(container, gitPath);
  } else {
    container.querySelector('.git-conflict-banner')?.remove();
  }
  renderStashSection(container, gitPath);
  renderTagSection(container, gitPath);
  renderReflogSection(container, gitPath);
  renderSubmoduleSection(container, gitPath);
}

function renderToolbar(container: HTMLElement, gitPath: string, status: GitMeta): void {
  let bar = container.querySelector('.git-toolbar') as HTMLDivElement | null;
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'git-toolbar';
    container.appendChild(bar);
  }
  const branch = status.branch || '(detached)';
  bar.innerHTML = '';

  const branchLabel = document.createElement('div');
  branchLabel.className = 'git-toolbar-branch';
  branchLabel.textContent = branch;
  bar.appendChild(branchLabel);

  const counts = document.createElement('div');
  counts.className = 'git-toolbar-counts';
  if (status.ahead > 0) counts.appendChild(makeChip(`↑${status.ahead}`, 'ahead'));
  if (status.behind > 0) counts.appendChild(makeChip(`↓${status.behind}`, 'behind'));
  bar.appendChild(counts);

  const actions = document.createElement('div');
  actions.className = 'git-toolbar-actions';
  actions.appendChild(toolBtn('↓', 'Fetch', () => { void doFetch(gitPath); }));
  actions.appendChild(toolBtn('⇅', 'Pull (rebase)', () => { void doPull(gitPath, true); }));
  actions.appendChild(
    toolBtn(`↑${status.ahead > 0 ? ` ${status.ahead}` : ''}`, 'Push', () => { void doPush(gitPath, status); }),
  );
  actions.appendChild(toolBtn('⌥', 'Commit history', () => { void showCommitHistory(gitPath); }));
  actions.appendChild(toolBtn('⎇', 'Compare branches', () => { void showBranchCompareModal(gitPath); }));
  actions.appendChild(toolBtn('⋯', 'More git actions', (ev) => {
    showMoreMenu(ev.currentTarget as HTMLElement, gitPath);
  }));
  bar.appendChild(actions);
}

let moreMenu: HTMLElement | null = null;

function hideMoreMenu(): void {
  moreMenu?.remove();
  moreMenu = null;
}

function showMoreMenu(anchor: HTMLElement, gitPath: string): void {
  hideMoreMenu();
  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 4}px`;

  const addItem = (label: string, onClick: () => void): void => {
    const item = document.createElement('div');
    item.className = 'tab-context-menu-item';
    item.textContent = label;
    item.addEventListener('click', () => {
      hideMoreMenu();
      onClick();
    });
    menu.appendChild(item);
  };

  addItem('Search history', () => { void showHistorySearchModal(gitPath); });
  addItem('Interactive rebase…', () => { void openRebasePrompt(gitPath); });
  addItem('Bisect…', () => { void showBisectWizard(gitPath); });

  document.body.appendChild(menu);
  moreMenu = menu;
  requestAnimationFrame(() => {
    document.addEventListener('mousedown', (e) => {
      if (moreMenu && !moreMenu.contains(e.target as Node) && e.target !== anchor) hideMoreMenu();
    }, { once: true });
  });
}

function makeChip(text: string, cls: string): HTMLElement {
  const el = document.createElement('span');
  el.className = `git-toolbar-chip ${cls}`;
  el.textContent = text;
  return el;
}

function toolBtn(
  icon: string,
  title: string,
  onClick: (ev: MouseEvent) => void,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'git-toolbar-btn';
  b.textContent = icon;
  b.setAttribute('aria-label', title);
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

// ---------------- G1 + G11: commit ----------------

function bindCommitValidity(el: HTMLElement, staged: number): void {
  el.dataset.staged = String(staged);
  const textarea = el.querySelector('.git-commit-input') as HTMLTextAreaElement | null;
  const charCount = el.querySelector('.git-commit-charcount') as HTMLElement | null;
  const btn = el.querySelector('.git-commit-btn') as HTMLButtonElement | null;
  const amend = el.querySelector('.git-amend-cb') as HTMLInputElement | null;
  const counter = el.querySelector('.git-commit-counter') as HTMLElement | null;
  if (!textarea || !charCount || !btn || !amend) return;
  if (counter) counter.textContent = `staged: ${staged}`;
  const subject = (textarea.value.split('\n')[0] || '').trim();
  btn.disabled = !canCommit(subject, staged, amend.checked);
  charCount.textContent = `${subject.length}/72`;
  charCount.classList.toggle('over', subject.length > 72);
  charCount.classList.toggle('warn', subject.length > 50 && subject.length <= 72);
}

function renderCommitArea(container: HTMLElement, gitPath: string, status: GitMeta): void {
  let el = container.querySelector('.git-commit-area') as HTMLDivElement | null;
  if (el) {
    bindCommitValidity(el, status.staged);
    return;
  }

  el = document.createElement('div');
  el.className = 'git-commit-area';
  el.innerHTML = `
    <div class="git-commit-row">
      <textarea class="git-commit-input" rows="3" aria-label="Commit message" placeholder="Commit message (subject on first line, body after blank line)"></textarea>
    </div>
    <div class="git-commit-meta">
      <label class="git-commit-amend"><input type="checkbox" class="git-amend-cb" /> Amend last</label>
      <span class="git-commit-counter">staged: ${status.staged}</span>
      <span class="git-commit-charcount">0/72</span>
    </div>
    <div class="git-commit-actions">
      <button type="button" class="git-commit-ai" aria-label="Generate commit message with AI">✨ Generate</button>
      <button type="button" class="git-commit-btn" disabled>Commit</button>
    </div>
  `;
  container.appendChild(el);

  const textarea = el.querySelector('.git-commit-input') as HTMLTextAreaElement;
  const btn = el.querySelector('.git-commit-btn') as HTMLButtonElement;
  const aiBtn = el.querySelector('.git-commit-ai') as HTMLButtonElement;
  const amend = el.querySelector('.git-amend-cb') as HTMLInputElement;

  const updateValidity = (): void => {
    bindCommitValidity(el!, Number(el!.dataset.staged || '0'));
  };
  textarea.addEventListener('input', updateValidity);
  bindCommitValidity(el, status.staged);

  amend.addEventListener('change', async () => {
    if (amend.checked) {
      const last = await window.aiyard.git.getLastCommit(gitPath);
      const combined = last.body ? `${last.subject}\n\n${last.body}` : last.subject;
      if (!textarea.value.trim() || confirm('Replace current commit message with previous?')) {
        textarea.value = combined;
      }
    }
    updateValidity();
  });

  aiBtn.addEventListener('click', async () => {
    aiBtn.disabled = true;
    aiBtn.textContent = '✨ ...';
    try {
      const diff = await getStagedDiffSummary(gitPath);
      if (!diff) { textarea.placeholder = 'Stage something first'; return; }
      const recentCommits = await window.aiyard.git.log(gitPath, { limit: 10 }).catch(() => []);
      const examples = recentCommits.map((c) => c.subject).filter(Boolean).slice(0, 5).join('\n');
      const prompt = [
        'Generate a Conventional Commits message for the following git diff.',
        'Format: <type>(<scope>): <subject>',
        'Types: feat, fix, refactor, chore, docs, test, perf, style, ci',
        'Rules: imperative mood, ≤72 chars subject, no period at end.',
        'Return ONLY the commit message, nothing else.',
        examples ? `\nMatch this style:\n${examples}` : '',
        '\nDiff:',
        diff.slice(0, 12_000),
      ].join('\n');
      const result = await window.aiyard.ai.callOnce(prompt, gitPath);
      if (result) {
        textarea.value = result.trim();
        updateValidity();
      } else {
        textarea.placeholder = 'AI generation failed - make sure Claude CLI is installed';
      }
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = '✨ Generate';
    }
  });

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const result = await window.aiyard.git.commit(gitPath, textarea.value, amend.checked);
      textarea.value = '';
      amend.checked = false;
      el!.dataset.staged = '0';
      updateValidity();
      flashToast(`✓ ${result.hash} - ${result.subject}`);
      await refresh();
    } catch (err) {
      flashToast(`✗ Commit failed: ${err instanceof Error ? err.message : String(err)}`);
      updateValidity();
    }
  });
}

async function getStagedDiffSummary(gitPath: string): Promise<string> {
  const files = (await window.aiyard.git.getFiles(gitPath)) as { path: string; area: string }[];
  const staged = files.filter((f) => f.area === 'staged').slice(0, 50);
  const parts: string[] = [];
  for (const f of staged) {
    const d = await window.aiyard.git.getDiff(gitPath, f.path, 'staged');
    parts.push(`### ${f.path}\n${d}`);
  }
  return parts.join('\n\n');
}

// ---------------- G2: remote ops ----------------

async function doFetch(gitPath: string): Promise<void> {
  flashToast('Fetching…');
  const r = await window.aiyard.git.fetch(gitPath, 'origin');
  flashToast(r.ok ? '✓ Fetched' : `✗ ${r.stderr || 'fetch failed'}`);
  await refresh();
}

async function doPull(gitPath: string, rebase: boolean): Promise<void> {
  flashToast(rebase ? 'Pulling (rebase)…' : 'Pulling…');
  const r = await window.aiyard.git.pull(gitPath, rebase);
  flashToast(r.ok ? '✓ Pulled' : `✗ ${r.stderr || 'pull failed'}`);
  await refresh();
}

async function doPush(gitPath: string, status: GitMeta): Promise<void> {
  if (status.behind > 0) {
    if (!confirm(`Branch is ${status.behind} behind. Pull first?`)) return;
    await doPull(gitPath, true);
  }
  flashToast('Pushing…');
  const r = await window.aiyard.git.push(gitPath, { setUpstream: true, branch: status.branch || undefined });
  if (!r.ok && /authentication/i.test(r.stderr)) {
    flashToast('Auth failure - open terminal to authenticate', 6000);
    return;
  }
  if (!r.ok && /rejected|non-fast-forward/i.test(r.stderr)) {
    showConfirmModal(
      'Force push?',
      'Push was rejected as non-fast-forward. Use --force-with-lease (safer than --force)?',
      async () => {
        const r2 = await window.aiyard.git.push(gitPath, {
          setUpstream: true,
          force: true,
          branch: status.branch || undefined,
        });
        flashToast(r2.ok ? '✓ Pushed (force-with-lease)' : `✗ ${r2.stderr || 'push failed'}`);
        await refresh();
      },
      { confirmLabel: 'Force push', danger: true },
    );
    return;
  }
  flashToast(r.ok ? '✓ Pushed' : `✗ ${r.stderr || 'push failed'}`);
  await refresh();
}

// ---------------- G10: conflict banner ----------------

async function renderConflictBanner(container: HTMLElement, gitPath: string): Promise<void> {
  let el = container.querySelector('.git-conflict-banner') as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'git-conflict-banner';
    container.appendChild(el);
  }
  const files = (await window.aiyard.git.getFiles(gitPath)) as { path: string; area: string }[];
  const conflicts = files.filter((f) => f.area === 'conflicted').map((f) => f.path);
  if (conflicts.length === 0) {
    el.remove();
    return;
  }
  el.innerHTML = `<strong>${conflicts.length}</strong> conflict${conflicts.length > 1 ? 's' : ''} — <button type="button" class="git-resolve-btn">Resolve</button>`;
  const btn = el.querySelector('.git-resolve-btn') as HTMLButtonElement;
  btn.addEventListener('click', () => showConflictResolver(gitPath, conflicts));
}

// ---------------- G4: stash ----------------

async function renderStashSection(container: HTMLElement, gitPath: string): Promise<void> {
  let el = container.querySelector('.git-stash-section') as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'git-stash-section config-section';
    el.innerHTML = `
      <div class="config-section-header">
        <span class="config-section-toggle collapsed">▼</span>Stashes<span class="config-section-count git-stash-count">0</span>
        <button type="button" class="git-stash-new" aria-label="Create stash">+</button>
      </div>
      <div class="config-section-body git-stash-body hidden"></div>
    `;
    container.appendChild(el);
    el.querySelector('.config-section-header')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('git-stash-new')) return;
      toggleSection(el!);
    });
    (el.querySelector('.git-stash-new') as HTMLButtonElement).addEventListener('click', async (e) => {
      e.stopPropagation();
      showModal(
        'New stash',
        [
          { id: 'msg', label: 'Message (optional)', type: 'text' },
          { id: 'untracked', label: 'Include untracked files', type: 'checkbox' },
        ],
        async (values) => {
          await window.aiyard.git.stashPush(gitPath, values.msg || undefined, values.untracked === 'true');
          closeModal();
          renderStashSection(container, gitPath);
        },
        { confirmLabel: 'Stash' },
      );
    });
  }
  const body = el.querySelector('.git-stash-body') as HTMLElement;
  const count = el.querySelector('.git-stash-count') as HTMLElement;
  const stashes = (await window.aiyard.git.stashList(gitPath)) as StashEntry[];
  count.textContent = String(stashes.length);
  body.innerHTML = '';
  if (stashes.length === 0) {
    body.innerHTML = '<div class="config-empty">No stashes</div>';
    return;
  }
  for (const s of stashes) {
    const row = document.createElement('div');
    row.className = 'config-item';
    row.innerHTML = `<span class="config-item-detail">${escapeHtml(s.message)}</span><span class="git-row-actions"></span>`;
    const acts = row.querySelector('.git-row-actions') as HTMLElement;
    acts.appendChild(rowBtn('Apply', () => doApply(gitPath, s.ref)));
    acts.appendChild(rowBtn('Pop', () => doPop(gitPath, s.ref)));
    acts.appendChild(rowBtn('Drop', () => {
      if (confirm(`Drop stash ${s.ref}?`)) doDrop(gitPath, s.ref);
    }));
    body.appendChild(row);
  }
}

async function doApply(gitPath: string, ref: string): Promise<void> {
  await window.aiyard.git.stashApply(gitPath, ref);
  flashToast(`Applied ${ref}`);
}
async function doPop(gitPath: string, ref: string): Promise<void> {
  await window.aiyard.git.stashPop(gitPath, ref);
  flashToast(`Popped ${ref}`);
}
async function doDrop(gitPath: string, ref: string): Promise<void> {
  await window.aiyard.git.stashDrop(gitPath, ref);
  flashToast(`Dropped ${ref}`);
}

// ---------------- G7: tags ----------------

async function renderTagSection(container: HTMLElement, gitPath: string): Promise<void> {
  let el = container.querySelector('.git-tag-section') as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'git-tag-section config-section';
    el.innerHTML = `
      <div class="config-section-header">
        <span class="config-section-toggle collapsed">▼</span>Tags<span class="config-section-count git-tag-count">0</span>
        <button type="button" class="git-tag-new" aria-label="Create tag">+</button>
      </div>
      <div class="config-section-body git-tag-body hidden"></div>
    `;
    container.appendChild(el);
    el.querySelector('.config-section-header')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('git-tag-new')) return;
      toggleSection(el!);
    });
    (el.querySelector('.git-tag-new') as HTMLButtonElement).addEventListener('click', (e) => {
      e.stopPropagation();
      showModal(
        'New tag',
        [
          { id: 'name', label: 'Name (e.g. v1.2.3)', type: 'text' },
          { id: 'message', label: 'Message (annotated tag if filled)', type: 'text' },
          { id: 'ref', label: 'Target ref (HEAD if blank)', type: 'text' },
        ],
        async (values) => {
          if (!values.name) return;
          await window.aiyard.git.createTag(gitPath, values.name, values.message || undefined, values.ref || undefined);
          closeModal();
          renderTagSection(container, gitPath);
        },
        { confirmLabel: 'Tag' },
      );
    });
  }
  const body = el.querySelector('.git-tag-body') as HTMLElement;
  const count = el.querySelector('.git-tag-count') as HTMLElement;
  const tags = (await window.aiyard.git.listTags(gitPath)) as TagEntry[];
  count.textContent = String(tags.length);
  body.innerHTML = '';
  if (tags.length === 0) {
    body.innerHTML = '<div class="config-empty">No tags</div>';
    return;
  }
  for (const t of tags.slice(0, 50)) {
    const row = document.createElement('div');
    row.className = 'config-item';
    row.innerHTML = `<span class="config-item-detail" title="${escapeHtml(t.subject)}">${escapeHtml(t.name)}</span><span class="git-row-actions"></span>`;
    const acts = row.querySelector('.git-row-actions') as HTMLElement;
    acts.appendChild(rowBtn('Push', async () => {
      const r = await window.aiyard.git.pushTag(gitPath, t.name);
      flashToast(r.ok ? `✓ Pushed ${t.name}` : `✗ ${r.stderr}`);
    }));
    acts.appendChild(rowBtn('Delete', () => {
      if (confirm(`Delete tag ${t.name}? (local only)`)) {
        window.aiyard.git.deleteTag(gitPath, t.name).then(() => renderTagSection(container, gitPath));
      }
    }));
    body.appendChild(row);
  }
}

// ---------------- G8: reflog ----------------

async function renderReflogSection(container: HTMLElement, gitPath: string): Promise<void> {
  let el = container.querySelector('.git-reflog-section') as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'git-reflog-section config-section';
    el.innerHTML = `
      <div class="config-section-header">
        <span class="config-section-toggle collapsed">▼</span>Reflog<span class="config-section-count git-reflog-count">…</span>
      </div>
      <div class="config-section-body git-reflog-body hidden"></div>
    `;
    container.appendChild(el);
    el.querySelector('.config-section-header')?.addEventListener('click', () => toggleSection(el!));
  }
  const body = el.querySelector('.git-reflog-body') as HTMLElement;
  const count = el.querySelector('.git-reflog-count') as HTMLElement;
  if (body.classList.contains('hidden')) return;

  const entries = (await window.aiyard.git.reflog(gitPath, 50)) as ReflogEntry[];
  count.textContent = String(entries.length);
  body.innerHTML = '';
  for (const r of entries.slice(0, 50)) {
    const row = document.createElement('div');
    row.className = 'config-item';
    row.innerHTML = `<span class="config-item-detail" title="${escapeHtml(r.action)}"><code>${escapeHtml(r.ref)}</code> ${escapeHtml(r.action)}</span><span class="git-row-actions"></span>`;
    const acts = row.querySelector('.git-row-actions') as HTMLElement;
    acts.appendChild(rowBtn('Branch here', () => {
      showModal(
        `Branch from ${r.hash.slice(0, 7)}`,
        [{ id: 'name', label: 'Branch name', type: 'text' }],
        async (values) => {
          if (!values.name) return;
          await window.aiyard.git.branchAt(gitPath, values.name, r.hash);
          closeModal();
        },
        { confirmLabel: 'Create' },
      );
    }));
    acts.appendChild(rowBtn('Reset…', () => {
      showResetDialog(gitPath, r.hash);
    }));
    body.appendChild(row);
  }
}

function showResetDialog(gitPath: string, hash: string): void {
  showModal(
    `Reset to ${hash.slice(0, 7)}`,
    [
      {
        id: 'mode',
        label: 'Mode',
        type: 'select',
        defaultValue: 'mixed',
        options: [
          { value: 'soft', label: 'soft (keep changes staged)' },
          { value: 'mixed', label: 'mixed (keep changes, unstage) [default]' },
          { value: 'hard', label: 'hard (discard ALL changes)' },
        ],
      },
    ],
    async (values) => {
      const mode = (values.mode || 'mixed') as 'soft' | 'mixed' | 'hard';
      if (mode === 'hard' && !confirm('Hard reset DISCARDS uncommitted changes. Continue?')) return;
      await window.aiyard.git.reset(gitPath, hash, mode);
      closeModal();
      flashToast(`Reset (${mode}) to ${hash.slice(0, 7)}`);
    },
    { confirmLabel: 'Reset' },
  );
}

// ---------------- G21: submodules ----------------

async function renderSubmoduleSection(container: HTMLElement, gitPath: string): Promise<void> {
  const subs = (await window.aiyard.git.submoduleList(gitPath)) as SubmoduleEntry[];
  const existing = container.querySelector('.git-submodule-section');
  if (subs.length === 0) {
    existing?.remove();
    return;
  }
  let el = existing as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'git-submodule-section config-section';
    el.innerHTML = `
      <div class="config-section-header">
        <span class="config-section-toggle collapsed">▼</span>Submodules<span class="config-section-count git-submodule-count">0</span>
        <button type="button" class="git-submodule-update-all" aria-label="Update all">⟳</button>
      </div>
      <div class="config-section-body git-submodule-body hidden"></div>
    `;
    container.appendChild(el);
    el.querySelector('.config-section-header')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('git-submodule-update-all')) return;
      toggleSection(el!);
    });
    (el.querySelector('.git-submodule-update-all') as HTMLButtonElement).addEventListener(
      'click',
      async (e) => {
        e.stopPropagation();
        flashToast('Updating submodules…');
        const r = await window.aiyard.git.submoduleUpdate(gitPath, true);
        flashToast(r.ok ? '✓ Submodules updated' : `✗ ${r.stderr || 'update failed'}`);
      },
    );
  }
  const body = el.querySelector('.git-submodule-body') as HTMLElement;
  const count = el.querySelector('.git-submodule-count') as HTMLElement;
  count.textContent = String(subs.length);
  body.innerHTML = '';
  for (const s of subs) {
    const row = document.createElement('div');
    row.className = 'config-item';
    row.innerHTML = `<span class="config-item-detail">${escapeHtml(s.path)} <code>${s.hash.slice(0, 7)}</code></span><span class="git-submodule-status ${s.status}">${s.status}</span>`;
    body.appendChild(row);
  }
}

// ---------------- G19: rebase ----------------

async function openRebasePrompt(gitPath: string): Promise<void> {
  const base = await window.aiyard.git.defaultBranch(gitPath).catch(() => 'main');
  showModal(
    'Interactive rebase',
    [
      {
        id: 'base',
        label: 'Rebase onto base',
        type: 'text',
        defaultValue: base,
      },
    ],
    async (values) => {
      const target = values.base || base;
      closeModal();
      const todos = (await window.aiyard.git.rebaseTodo(gitPath, target)) as RebaseTodo[];
      if (todos.length === 0) {
        flashToast('No commits between HEAD and base.');
        return;
      }
      showRebaseModal(gitPath, target, todos);
    },
    { confirmLabel: 'Plan rebase' },
  );
}

// ---------------- helpers ----------------

function rowBtn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'git-row-btn';
  b.textContent = label;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function toggleSection(el: HTMLElement): void {
  const body = el.querySelector('.config-section-body');
  const toggle = el.querySelector('.config-section-toggle');
  body?.classList.toggle('hidden');
  toggle?.classList.toggle('collapsed');
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

let activeToast: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function flashToast(text: string, duration = 3000): void {
  if (activeToast) activeToast.remove();
  if (toastTimer) clearTimeout(toastTimer);
  const t = document.createElement('div');
  t.className = 'git-toast';
  t.textContent = text;
  document.body.appendChild(t);
  activeToast = t;
  toastTimer = setTimeout(() => {
    t.classList.add('fadeout');
    setTimeout(() => t.remove(), 300);
  }, duration);
}

export type { ConflictedFile };
