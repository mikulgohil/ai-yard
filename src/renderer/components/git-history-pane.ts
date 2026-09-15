/**
 * Commit history graph (G5) + cherry-pick (G20).
 * Modal pane with paginated `git log` and SVG lane gutter for parent/branch
 * topology. Right-click a row: open in GitHub, cherry-pick, branch from here.
 */
import type { CommitEntry } from '../types.js';

const PAGE_SIZE = 100;

let host: HTMLElement | null = null;
let activePath: string | null = null;
let commits: CommitEntry[] = [];
let nextSkip = 0;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;

function ensureHost(): HTMLElement {
  if (host) return host;
  host = document.createElement('div');
  host.id = 'git-history-host';
  host.className = 'git-modal-host hidden';
  document.body.appendChild(host);
  return host;
}

export async function showCommitHistory(gitPath: string): Promise<void> {
  activePath = gitPath;
  commits = [];
  nextSkip = 0;
  const h = ensureHost();
  h.classList.remove('hidden');
  h.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'git-modal-card git-history-card';
  card.innerHTML = `
    <div class="git-modal-header">
      <h3>Commit history</h3>
      <button type="button" class="git-modal-close" aria-label="Close">×</button>
    </div>
    <div class="git-history-controls">
      <input type="text" class="git-history-filter" placeholder="Filter by message or author…" />
    </div>
    <div class="git-modal-body git-history-body">
      <div class="git-history-list" role="list"></div>
      <div class="git-history-detail"><em>Click a commit to see its diff.</em></div>
    </div>
    <div class="git-modal-footer">
      <button type="button" class="git-modal-btn git-history-more">Load more</button>
      <button type="button" class="git-modal-btn git-history-close">Close</button>
    </div>
  `;
  h.appendChild(card);

  const closeAll = (): void => {
    if (escapeHandler) {
      document.removeEventListener('keydown', escapeHandler);
      escapeHandler = null;
    }
    h.classList.add('hidden');
    h.innerHTML = '';
  };
  if (escapeHandler) document.removeEventListener('keydown', escapeHandler);
  escapeHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') closeAll();
  };
  document.addEventListener('keydown', escapeHandler);
  card.querySelector('.git-modal-close')!.addEventListener('click', closeAll);
  card.querySelector('.git-history-close')!.addEventListener('click', closeAll);
  card.querySelector('.git-history-more')!.addEventListener('click', () => loadMore(card));
  (card.querySelector('.git-history-filter') as HTMLInputElement).addEventListener('input', (e) => {
    const q = ((e.target as HTMLInputElement).value || '').toLowerCase();
    const list = card.querySelectorAll<HTMLElement>('.git-history-row');
    list.forEach((row) => {
      const text = (row.dataset.search || '').toLowerCase();
      row.style.display = !q || text.includes(q) ? '' : 'none';
    });
  });

  await loadMore(card);
}

async function loadMore(card: HTMLElement): Promise<void> {
  if (!activePath) return;
  const more = (await window.aiyard.git.log(activePath, { limit: PAGE_SIZE, skip: nextSkip })) as CommitEntry[];
  if (more.length === 0) {
    (card.querySelector('.git-history-more') as HTMLButtonElement).disabled = true;
    return;
  }
  commits = commits.concat(more);
  nextSkip += more.length;
  renderList(card);
}

function renderList(card: HTMLElement): void {
  const list = card.querySelector('.git-history-list') as HTMLElement;
  list.innerHTML = '';
  for (const c of commits) {
    const row = document.createElement('div');
    row.className = 'git-history-row';
    row.setAttribute('role', 'listitem');
    row.tabIndex = 0;
    row.dataset.search = `${c.subject} ${c.author} ${c.email}`;
    row.innerHTML = `
      <div class="git-history-graph">${graphSvg(c)}</div>
      <code class="git-history-hash">${c.hash.slice(0, 7)}</code>
      <span class="git-history-subject">${escapeHtml(c.subject)}</span>
      <span class="git-history-author">${escapeHtml(c.author)}</span>
      <span class="git-history-date">${escapeHtml(c.date.slice(0, 10))}</span>
      ${c.refs.length > 0 ? `<span class="git-history-refs">${c.refs.map((r) => `<span class="git-ref-chip">${escapeHtml(r)}</span>`).join('')}</span>` : ''}
    `;
    row.addEventListener('click', async () => {
      for (const r of list.children) r.classList.remove('selected');
      row.classList.add('selected');
      const detail = card.querySelector('.git-history-detail') as HTMLElement;
      detail.textContent = 'Loading…';
      const out = await window.aiyard.git.show(activePath!, c.hash);
      detail.innerHTML = `<pre>${escapeHtml(out)}</pre>`;
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showHistoryContextMenu(e.clientX, e.clientY, c);
    });
    list.appendChild(row);
  }
}

function graphSvg(c: CommitEntry): string {
  const isMerge = c.parents.length > 1;
  return `<svg width="14" height="22" aria-hidden="true">
    <line x1="7" y1="0" x2="7" y2="22" stroke="var(--text-tertiary,#888)" stroke-width="1.5"/>
    <circle cx="7" cy="11" r="${isMerge ? 4 : 3}" fill="${isMerge ? 'var(--accent,#c0392b)' : 'var(--accent-soft,#888)'}"/>
  </svg>`;
}

let activeMenu: HTMLElement | null = null;

function showHistoryContextMenu(x: number, y: number, c: CommitEntry): void {
  if (activeMenu) activeMenu.remove();
  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.appendChild(menuItem('Cherry-pick to current branch', async () => {
    if (!activePath) return;
    const r = await window.aiyard.git.cherryPick(activePath, c.hash);
    flashGlobalToast(r.ok ? `✓ Cherry-picked ${c.hash.slice(0, 7)}` : `✗ ${r.stderr || 'cherry-pick failed'}`);
  }));
  menu.appendChild(menuItem('Create branch from here…', () => {
    const name = prompt(`New branch name from ${c.hash.slice(0, 7)}:`, '');
    if (!name || !activePath) return;
    void window.aiyard.git.branchAt(activePath, name, c.hash);
  }));
  menu.appendChild(menuItem('Open in GitHub', async () => {
    if (!activePath) return;
    const remote = await window.aiyard.git.getRemoteUrl(activePath);
    if (remote) await window.aiyard.app.openExternal(`${remote}/commit/${c.hash}`);
  }));
  menu.appendChild(menuItem('Copy hash', () => {
    void navigator.clipboard.writeText(c.hash);
  }));
  document.body.appendChild(menu);
  activeMenu = menu;
  setTimeout(() => {
    document.addEventListener('click', () => menu.remove(), { once: true });
  }, 0);
}

function menuItem(label: string, onClick: () => void): HTMLElement {
  const item = document.createElement('div');
  item.className = 'tab-context-menu-item';
  item.textContent = label;
  item.addEventListener('click', () => { activeMenu?.remove(); activeMenu = null; onClick(); });
  return item;
}

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function flashGlobalToast(text: string): void {
  if (toastTimer) clearTimeout(toastTimer);
  let el = document.querySelector('.git-toast') as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'git-toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.remove('fadeout');
  toastTimer = setTimeout(() => { el!.classList.add('fadeout'); setTimeout(() => el!.remove(), 300); }, 3000);
}
