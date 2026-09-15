/**
 * Git modals — branch compare (G9), conflict resolver (G10 + G14 AI),
 * history search (G18), interactive rebase (G19), bisect wizard (G15).
 * Cherry-pick (G20) attaches into the history view.
 *
 * These all reuse a lightweight overlay built on #modal-overlay; for richer
 * pane-style UIs we mount into a dedicated #git-modal-host that floats above.
 */
import type {
  BranchCompareResult,
  CommitEntry,
  ConflictedFile,
  GrepMatch,
  PickaxeMatch,
  RebaseAction,
  RebaseTodo,
} from '../types.js';

let host: HTMLElement | null = null;

function ensureHost(): HTMLElement {
  if (host) return host;
  host = document.createElement('div');
  host.id = 'git-modal-host';
  host.className = 'git-modal-host hidden';
  document.body.appendChild(host);
  return host;
}

function close(): void {
  if (!host) return;
  host.classList.add('hidden');
  host.innerHTML = '';
}

function shell(title: string, body: HTMLElement, footerActions: HTMLElement[] = []): HTMLElement {
  const h = ensureHost();
  h.classList.remove('hidden');
  h.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'git-modal-card';

  const header = document.createElement('div');
  header.className = 'git-modal-header';
  const titleEl = document.createElement('h3');
  titleEl.textContent = title;
  header.appendChild(titleEl);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'git-modal-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', close);
  header.appendChild(closeBtn);
  card.appendChild(header);

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'git-modal-body';
  bodyWrap.appendChild(body);
  card.appendChild(bodyWrap);

  const footer = document.createElement('div');
  footer.className = 'git-modal-footer';
  for (const a of footerActions) footer.appendChild(a);
  if (footerActions.length > 0) card.appendChild(footer);

  h.appendChild(card);
  return card;
}

function btn(label: string, onClick: () => void, variant?: 'primary' | 'danger'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `git-modal-btn${variant ? ` ${variant}` : ''}`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ---------------------------------------------------------------------------
// G9 — Branch compare (also: G12 AI PR description handoff)
// ---------------------------------------------------------------------------

export async function showBranchCompareModal(gitPath: string): Promise<void> {
  const branches = await window.aiyard.git.listBranches(gitPath);
  const def = await window.aiyard.git.defaultBranch(gitPath).catch(() => 'main');
  const current = branches.find((b) => b.current)?.name || 'HEAD';

  const body = document.createElement('div');
  body.className = 'git-branch-compare';
  body.innerHTML = `
    <div class="git-branch-compare-controls">
      <label>Base
        <select class="branch-compare-base"></select>
      </label>
      <label>Head
        <select class="branch-compare-head"></select>
      </label>
      <button type="button" class="git-modal-btn primary branch-compare-go">Compare</button>
    </div>
    <div class="git-branch-compare-result"><em>Pick branches and click Compare.</em></div>
  `;
  const baseSel = body.querySelector('.branch-compare-base') as HTMLSelectElement;
  const headSel = body.querySelector('.branch-compare-head') as HTMLSelectElement;
  for (const b of branches) {
    const o1 = document.createElement('option');
    o1.value = b.name;
    o1.textContent = b.name;
    if (b.name === def) o1.selected = true;
    baseSel.appendChild(o1);
    const o2 = document.createElement('option');
    o2.value = b.name;
    o2.textContent = b.name;
    if (b.name === current) o2.selected = true;
    headSel.appendChild(o2);
  }

  const result = body.querySelector('.git-branch-compare-result') as HTMLElement;

  (body.querySelector('.branch-compare-go') as HTMLButtonElement).addEventListener('click', async () => {
    result.innerHTML = '<em>Loading…</em>';
    const data = (await window.aiyard.git.compareBranches(gitPath, baseSel.value, headSel.value)) as BranchCompareResult;
    renderBranchCompareResult(result, data, gitPath, baseSel.value, headSel.value);
  });

  shell('Compare branches', body, [btn('Close', close)]);
}

function renderBranchCompareResult(
  container: HTMLElement,
  data: BranchCompareResult,
  gitPath: string,
  base: string,
  head: string,
): void {
  container.innerHTML = '';
  const summary = document.createElement('div');
  summary.className = 'branch-compare-summary';
  summary.innerHTML = `<strong>${data.commits.length}</strong> commits, <strong>${data.files.length}</strong> files changed`;
  container.appendChild(summary);

  const actions = document.createElement('div');
  actions.className = 'branch-compare-actions';
  actions.appendChild(btn('Open as PR', () => openAsPr(gitPath, base, head, data), 'primary'));
  actions.appendChild(btn('✨ AI PR description', () => generateAiPrDescription(gitPath, base, head, data), 'primary'));
  container.appendChild(actions);

  const commitsBox = document.createElement('div');
  commitsBox.className = 'branch-compare-commits';
  commitsBox.innerHTML = '<h4>Commits unique to head</h4>';
  for (const c of data.commits) {
    const row = document.createElement('div');
    row.className = 'config-item';
    row.innerHTML = `<code>${c.hash.slice(0, 7)}</code> ${escapeHtml(c.subject)} <span class="git-meta">— ${escapeHtml(c.author)}</span>`;
    commitsBox.appendChild(row);
  }
  container.appendChild(commitsBox);

  const filesBox = document.createElement('div');
  filesBox.className = 'branch-compare-files';
  filesBox.innerHTML = '<h4>Changed files</h4>';
  for (const f of data.files) {
    const row = document.createElement('div');
    row.className = 'config-item';
    row.innerHTML = `<span class="git-file-badge ${f.status}">${f.status[0].toUpperCase()}</span><span class="config-item-detail">${escapeHtml(f.path)}</span><span class="git-meta">+${f.additions} -${f.deletions}</span>`;
    filesBox.appendChild(row);
  }
  container.appendChild(filesBox);
}

async function openAsPr(
  gitPath: string,
  base: string,
  head: string,
  data: BranchCompareResult,
  prefilledBody?: string,
): Promise<void> {
  const remote = await window.aiyard.git.getRemoteUrl(gitPath);
  if (!remote) {
    alert('No origin remote configured.');
    return;
  }
  const title = data.commits[0]?.subject || `${head} → ${base}`;
  const body = prefilledBody || data.commits.map((c) => `- ${c.subject}`).join('\n');
  const url = `${remote}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?expand=1&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  await window.aiyard.app.openExternal(url);
}

// ---------------------------------------------------------------------------
// G12 — AI PR description (composes with G9 branch compare)
// ---------------------------------------------------------------------------

async function generateAiPrDescription(
  gitPath: string,
  base: string,
  head: string,
  data: BranchCompareResult,
): Promise<void> {
  const body = document.createElement('div');
  body.innerHTML = '<p>Generating PR description with Claude…</p>';
  const ta = document.createElement('textarea');
  ta.rows = 14;
  ta.style.cssText = 'width:100%;font-family:var(--font-mono);font-size:12px;';
  body.appendChild(ta);

  const copyBtn = btn('Copy', () => {
    void navigator.clipboard.writeText(ta.value);
  });
  const openBtn = btn('Open PR with this description', async () => {
    await openAsPr(gitPath, base, head, data, ta.value);
  }, 'primary');

  shell('AI PR description', body, [copyBtn, openBtn, btn('Close', close)]);

  const filesList = data.files.map((f) => `${f.path} (+${f.additions} -${f.deletions})`).join('\n');
  const commitsList = data.commits.map((c) => `- ${c.subject} (${c.author})`).join('\n');

  const prompt = [
    'You are helping a developer write a GitHub PR description.',
    `Branch: ${head} → ${base}`,
    `\nCommits:\n${commitsList || '(none)'}`,
    `\nChanged files (${data.files.length}):\n${filesList}`,
    '',
    'Write a PR description with these sections:',
    '## Summary',
    '## Changes',
    '## Testing',
    '',
    'Be concise. Use bullet points. No fluff.',
  ].join('\n');

  const result = await window.aiyard.ai.callOnce(prompt, gitPath);
  ta.value = result || '⚠ AI generation failed. Make sure Claude CLI is installed.';
}

// ---------------------------------------------------------------------------
// G10 + G14 — Conflict resolver (with optional AI assistance)
// ---------------------------------------------------------------------------

export async function showConflictResolver(gitPath: string, conflictedFiles: string[]): Promise<void> {
  if (conflictedFiles.length === 0) return;
  let activeFile = conflictedFiles[0];

  const body = document.createElement('div');
  body.className = 'git-conflict-resolver';
  body.innerHTML = `
    <div class="conflict-files"></div>
    <div class="conflict-panes">
      <div class="conflict-pane"><h4>Ours</h4><pre class="conflict-ours"></pre></div>
      <div class="conflict-pane">
        <h4>Result <button class="conflict-ai" title="Resolve with AI">✨ AI</button></h4>
        <textarea class="conflict-result" rows="20"></textarea>
      </div>
      <div class="conflict-pane"><h4>Theirs</h4><pre class="conflict-theirs"></pre></div>
    </div>
  `;
  const filesBar = body.querySelector('.conflict-files') as HTMLElement;
  for (const f of conflictedFiles) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.textContent = f;
    tab.className = `conflict-file-tab${f === activeFile ? ' active' : ''}`;
    tab.addEventListener('click', () => {
      activeFile = f;
      [...filesBar.children].forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      void load();
    });
    filesBar.appendChild(tab);
  }

  const oursEl = body.querySelector('.conflict-ours') as HTMLElement;
  const theirsEl = body.querySelector('.conflict-theirs') as HTMLElement;
  const resultEl = body.querySelector('.conflict-result') as HTMLTextAreaElement;
  const aiBtn = body.querySelector('.conflict-ai') as HTMLButtonElement;
  let cf: ConflictedFile = { current: '', base: '', ours: '', theirs: '' };

  async function load(): Promise<void> {
    cf = await window.aiyard.git.getConflictedFile(gitPath, activeFile);
    oursEl.textContent = cf.ours;
    theirsEl.textContent = cf.theirs;
    resultEl.value = stripConflictMarkers(cf.current);
  }

  aiBtn.addEventListener('click', async () => {
    aiBtn.disabled = true;
    aiBtn.textContent = '✨ …';
    if (/package-lock\.json|yarn\.lock|pnpm-lock\.yaml/.test(activeFile)) {
      if (confirm('For lockfiles, AI resolution is unreliable. Accept ours and reinstall manually?')) {
        resultEl.value = cf.ours;
      }
      aiBtn.disabled = false;
      aiBtn.textContent = '✨ AI';
      return;
    }
    const prompt = [
      'You are resolving a git merge conflict. Choose the correct resolution.',
      '',
      'BASE (before both branches changed):',
      cf.base,
      '',
      'OURS (current branch):',
      cf.ours,
      '',
      'THEIRS (incoming branch):',
      cf.theirs,
      '',
      'Return ONLY the resolved file contents, no explanation, no conflict markers.',
      'If you are not confident, respond with the literal token UNSURE on its own line.',
    ].join('\n');
    const result = await window.aiyard.ai.callOnce(prompt, gitPath);
    if (!result || result.trim() === 'UNSURE') {
      alert('AI is not confident. Please resolve manually.');
    } else {
      resultEl.value = result;
    }
    aiBtn.disabled = false;
    aiBtn.textContent = '✨ AI';
  });

  const markBtn = btn('Mark resolved & stage', async () => {
    await window.aiyard.git.resolveConflict(gitPath, activeFile, resultEl.value);
    const remaining = conflictedFiles.filter((f) => f !== activeFile);
    close();
    if (remaining.length > 0) showConflictResolver(gitPath, remaining);
  }, 'primary');

  shell('Resolve conflict', body, [markBtn, btn('Close', close)]);
  await load();
}

function stripConflictMarkers(content: string): string {
  return content
    .split('\n')
    .filter((l) => !/^<{7}|^={7}|^>{7}/.test(l))
    .join('\n');
}

// ---------------------------------------------------------------------------
// G18 — History search (pickaxe, grep, log-grep)
// ---------------------------------------------------------------------------

export function showHistorySearchModal(gitPath: string): void {
  const body = document.createElement('div');
  body.className = 'git-search';
  body.innerHTML = `
    <div class="git-search-controls">
      <label><input type="radio" name="git-search-mode" value="pickaxe" checked /> Code change (pickaxe)</label>
      <label><input type="radio" name="git-search-mode" value="grep" /> Current grep</label>
      <label><input type="radio" name="git-search-mode" value="logGrep" /> Commit message</label>
      <input type="text" class="git-search-input" placeholder="Search query…" autofocus />
      <button type="button" class="git-modal-btn primary git-search-go">Search</button>
    </div>
    <div class="git-search-results"><em>Enter a query and click Search.</em></div>
  `;
  const input = body.querySelector('.git-search-input') as HTMLInputElement;
  const goBtn = body.querySelector('.git-search-go') as HTMLButtonElement;
  const resultsEl = body.querySelector('.git-search-results') as HTMLElement;

  async function run(): Promise<void> {
    const q = input.value.trim();
    if (!q) return;
    const mode = (body.querySelector('input[name="git-search-mode"]:checked') as HTMLInputElement).value;
    resultsEl.innerHTML = '<em>Searching…</em>';
    if (mode === 'pickaxe' || mode === 'logGrep') {
      const fn = mode === 'pickaxe' ? window.aiyard.git.pickaxe.bind(window.aiyard.git) : window.aiyard.git.logGrep.bind(window.aiyard.git);
      const matches = (await fn(gitPath, q, 30)) as PickaxeMatch[];
      resultsEl.innerHTML = '';
      if (matches.length === 0) { resultsEl.innerHTML = '<em>No matches.</em>'; return; }
      for (const m of matches) {
        const row = document.createElement('div');
        row.className = 'config-item';
        row.innerHTML = `<code>${m.hash.slice(0, 7)}</code> ${escapeHtml(m.subject)} <span class="git-meta">— ${escapeHtml(m.author)} ${escapeHtml(m.date)}</span>`;
        resultsEl.appendChild(row);
      }
    } else {
      const matches = (await window.aiyard.git.grep(gitPath, q)) as GrepMatch[];
      resultsEl.innerHTML = '';
      if (matches.length === 0) { resultsEl.innerHTML = '<em>No matches.</em>'; return; }
      for (const m of matches.slice(0, 200)) {
        const row = document.createElement('div');
        row.className = 'config-item config-item-clickable';
        row.innerHTML = `<span class="config-item-detail">${escapeHtml(m.path)}:${m.line}</span><span class="git-meta">${escapeHtml(m.content.slice(0, 200))}</span>`;
        row.addEventListener('click', () => window.aiyard.git.openInEditor(gitPath, m.path));
        resultsEl.appendChild(row);
      }
    }
  }

  goBtn.addEventListener('click', run);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });

  shell('Search history', body, [btn('Close', close)]);
}

// ---------------------------------------------------------------------------
// G19 — Interactive rebase
// ---------------------------------------------------------------------------

const REBASE_ACTIONS: RebaseAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];

export function showRebaseModal(gitPath: string, base: string, todos: RebaseTodo[]): void {
  const list = todos.map((t) => ({ ...t }));

  const body = document.createElement('div');
  body.className = 'git-rebase';
  body.innerHTML = `
    <p>Rebasing ${list.length} commits onto <code>${escapeHtml(base)}</code>. Drag to reorder. <strong>Don't rebase shared branches.</strong></p>
    <div class="git-rebase-list"></div>
  `;
  const listEl = body.querySelector('.git-rebase-list') as HTMLElement;

  function render(): void {
    listEl.innerHTML = '';
    list.forEach((todo, i) => {
      const row = document.createElement('div');
      row.className = `git-rebase-row ${todo.action}`;
      row.draggable = true;
      row.dataset.index = String(i);

      const actionSel = document.createElement('select');
      for (const a of REBASE_ACTIONS) {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        if (a === todo.action) opt.selected = true;
        actionSel.appendChild(opt);
      }
      actionSel.addEventListener('change', () => {
        list[i].action = actionSel.value as RebaseAction;
        render();
      });

      const subj = document.createElement('input');
      subj.type = 'text';
      subj.value = todo.subject;
      subj.className = 'git-rebase-subj';
      subj.disabled = todo.action !== 'reword';
      subj.addEventListener('input', () => { list[i].subject = subj.value; });

      const hash = document.createElement('code');
      hash.textContent = todo.hash.slice(0, 7);

      row.appendChild(actionSel);
      row.appendChild(hash);
      row.appendChild(subj);
      attachDnd(row, listEl, list, render);
      listEl.appendChild(row);
    });
  }
  render();

  const applyBtn = btn('Apply', async () => {
    const r = await window.aiyard.git.rebaseApply(gitPath, base, list);
    if (!r.ok) alert(`Rebase failed:\n${r.stderr}`);
    close();
  }, 'primary');
  const abortBtn = btn('Abort', async () => {
    await window.aiyard.git.rebaseAbort(gitPath).catch(() => {});
    close();
  }, 'danger');

  shell('Interactive rebase', body, [abortBtn, applyBtn, btn('Close', close)]);
}

function attachDnd(row: HTMLElement, container: HTMLElement, list: RebaseTodo[], rerender: () => void): void {
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/plain', row.dataset.index || '0');
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));
  row.addEventListener('dragover', (e) => e.preventDefault());
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    const fromIdx = parseInt(e.dataTransfer?.getData('text/plain') || '0', 10);
    const toIdx = parseInt(row.dataset.index || '0', 10);
    if (fromIdx === toIdx) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    rerender();
  });
}

// ---------------------------------------------------------------------------
// G15 — Bisect wizard
// ---------------------------------------------------------------------------

export async function showBisectWizard(gitPath: string): Promise<void> {
  const recent = (await window.aiyard.git.log(gitPath, { limit: 50 })) as CommitEntry[];

  const body = document.createElement('div');
  body.className = 'git-bisect';
  body.innerHTML = `
    <p>Bisect finds the commit that introduced a regression. Pick a known-good commit and a known-bad commit, or run a test command.</p>
    <div class="bisect-form">
      <label>Bad (broken) commit
        <select class="bisect-bad"></select>
      </label>
      <label>Good (working) commit
        <select class="bisect-good"></select>
      </label>
      <label>Test command (optional, auto-bisect)
        <input type="text" class="bisect-cmd" placeholder="e.g. npm test -- foo.test.ts" />
      </label>
    </div>
    <div class="bisect-output"><em>Pick endpoints and click Start.</em></div>
  `;
  const badSel = body.querySelector('.bisect-bad') as HTMLSelectElement;
  const goodSel = body.querySelector('.bisect-good') as HTMLSelectElement;
  const headOpt = document.createElement('option');
  headOpt.value = 'HEAD';
  headOpt.textContent = 'HEAD (current)';
  badSel.appendChild(headOpt);
  for (const c of recent) {
    const o1 = document.createElement('option');
    o1.value = c.hash;
    o1.textContent = `${c.hash.slice(0, 7)} ${c.subject}`;
    badSel.appendChild(o1);
    const o2 = o1.cloneNode(true) as HTMLOptionElement;
    goodSel.appendChild(o2);
  }
  const out = body.querySelector('.bisect-output') as HTMLElement;

  const startBtn = btn('Start', async () => {
    out.innerHTML = '<em>Starting…</em>';
    const cmd = (body.querySelector('.bisect-cmd') as HTMLInputElement).value.trim();
    await window.aiyard.git.bisectStart(gitPath, badSel.value, goodSel.value);
    if (cmd) {
      out.innerHTML = '<em>Auto-bisecting…</em>';
      const r = await window.aiyard.git.bisectRun(gitPath, cmd);
      out.innerHTML = `<pre>${escapeHtml(r.stdout + '\n' + r.stderr)}</pre>`;
    } else {
      out.innerHTML = `
        <div class="bisect-step">
          <button type="button" class="bisect-good-btn">Mark good</button>
          <button type="button" class="bisect-bad-btn">Mark bad</button>
          <button type="button" class="bisect-reset-btn">Reset</button>
          <pre class="bisect-log"></pre>
        </div>`;
      const log = out.querySelector('.bisect-log') as HTMLElement;
      const setLog = async (text: string): Promise<void> => { log.textContent = text; };
      out.querySelector('.bisect-good-btn')!.addEventListener('click', async () => setLog(await window.aiyard.git.bisectGood(gitPath)));
      out.querySelector('.bisect-bad-btn')!.addEventListener('click', async () => setLog(await window.aiyard.git.bisectBad(gitPath)));
      out.querySelector('.bisect-reset-btn')!.addEventListener('click', async () => {
        await window.aiyard.git.bisectReset(gitPath);
        close();
      });
    }
  }, 'primary');

  shell('Bisect', body, [startBtn, btn('Reset bisect', async () => {
    await window.aiyard.git.bisectReset(gitPath).catch(() => {});
    close();
  }), btn('Close', close)]);
}

export { close as closeGitModal };
