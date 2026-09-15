/**
 * Smaller git surfaces — hunk staging (G3), blame (G6), PR review (G13).
 * Kept in one file because each is a single self-contained pane.
 */
import type { BlameEntry, PRComment, PRDetail, PRFile } from '../types.js';

let host: HTMLElement | null = null;
function ensureHost(): HTMLElement {
  if (host) return host;
  host = document.createElement('div');
  host.id = 'git-extras-host';
  host.className = 'git-modal-host hidden';
  document.body.appendChild(host);
  return host;
}
function close(): void { if (host) { host.classList.add('hidden'); host.innerHTML = ''; } }

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ---------------------------------------------------------------------------
// G3 — Hunk staging
// ---------------------------------------------------------------------------

interface Hunk {
  header: string;
  body: string[];
}

function parseHunks(diff: string): { fileHeader: string; hunks: Hunk[] } {
  const lines = diff.split('\n');
  const fileHeaderLines: string[] = [];
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current) hunks.push(current);
      current = { header: line, body: [] };
    } else if (current) {
      current.body.push(line);
    } else if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    ) {
      fileHeaderLines.push(line);
    }
  }
  if (current) hunks.push(current);
  return { fileHeader: fileHeaderLines.join('\n'), hunks };
}

function buildHunkPatch(fileHeader: string, hunk: Hunk): string {
  return `${fileHeader}\n${hunk.header}\n${hunk.body.join('\n')}\n`;
}

export async function showHunkStaging(gitPath: string, filePath: string, area: 'staged' | 'working'): Promise<void> {
  const diff = await window.aiyard.git.getDiff(gitPath, filePath, area);
  const { fileHeader, hunks } = parseHunks(diff);
  const h = ensureHost();
  h.classList.remove('hidden');
  h.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'git-modal-card git-hunk-card';
  card.innerHTML = `
    <div class="git-modal-header">
      <h3>Hunks: ${escapeHtml(filePath)}</h3>
      <button type="button" class="git-modal-close" aria-label="Close">×</button>
    </div>
    <div class="git-modal-body git-hunk-body"></div>
    <div class="git-modal-footer"><button type="button" class="git-modal-btn">Close</button></div>
  `;
  card.querySelector('.git-modal-close')!.addEventListener('click', close);
  card.querySelector('.git-modal-footer button')!.addEventListener('click', close);
  const body = card.querySelector('.git-hunk-body') as HTMLElement;

  if (hunks.length === 0) {
    body.innerHTML = '<em>No hunks to stage.</em>';
    h.appendChild(card);
    return;
  }

  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i];
    const block = document.createElement('div');
    block.className = 'git-hunk-block';
    const actionLabel = area === 'staged' ? 'Unstage hunk' : 'Stage hunk';
    block.innerHTML = `
      <div class="git-hunk-header">
        <code>${escapeHtml(hunk.header)}</code>
        <button type="button" class="git-modal-btn primary git-hunk-action">${actionLabel}</button>
      </div>
      <pre class="git-hunk-pre">${hunk.body.map(formatDiffLine).join('\n')}</pre>
    `;
    block.querySelector('.git-hunk-action')!.addEventListener('click', async () => {
      const patch = buildHunkPatch(fileHeader, hunk);
      try {
        if (area === 'staged') await window.aiyard.git.unstageHunk(gitPath, patch);
        else await window.aiyard.git.stageHunk(gitPath, patch);
        block.classList.add('staged');
        (block.querySelector('.git-hunk-action') as HTMLButtonElement).disabled = true;
      } catch (err) {
        alert(`Failed to apply hunk: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    body.appendChild(block);
  }
  h.appendChild(card);
}

function formatDiffLine(line: string): string {
  const cls = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : '';
  return `<span class="git-diff-line ${cls}">${escapeHtml(line)}</span>`;
}

// ---------------------------------------------------------------------------
// G6 — Blame
// ---------------------------------------------------------------------------

export async function showBlame(gitPath: string, filePath: string): Promise<void> {
  const entries = (await window.aiyard.git.blame(gitPath, filePath)) as BlameEntry[];
  const h = ensureHost();
  h.classList.remove('hidden');
  h.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'git-modal-card git-blame-card';
  card.innerHTML = `
    <div class="git-modal-header">
      <h3>Blame: ${escapeHtml(filePath)}</h3>
      <button type="button" class="git-modal-close" aria-label="Close">×</button>
    </div>
    <div class="git-modal-body git-blame-body"></div>
    <div class="git-modal-footer"><button type="button" class="git-modal-btn">Close</button></div>
  `;
  card.querySelector('.git-modal-close')!.addEventListener('click', close);
  card.querySelector('.git-modal-footer button')!.addEventListener('click', close);
  const body = card.querySelector('.git-blame-body') as HTMLElement;

  if (entries.length === 0) {
    body.innerHTML = '<em>No blame data (untracked file?).</em>';
    h.appendChild(card);
    return;
  }
  const now = Date.now();
  let lastHash = '';
  for (const e of entries) {
    const row = document.createElement('div');
    row.className = 'git-blame-row';
    const same = e.hash === lastHash;
    lastHash = e.hash;
    const ageMs = e.date ? now - new Date(e.date).getTime() : 0;
    const ageHue = Math.max(0, Math.min(120, 120 - ageMs / (1000 * 60 * 60 * 24 * 30)));
    row.innerHTML = `
      <span class="git-blame-gutter" style="border-left:3px solid hsl(${ageHue},60%,50%)">
        ${same ? '' : `<code>${e.hash.slice(0, 7)}</code> ${escapeHtml(e.author)} ${escapeHtml((e.date || '').slice(0, 10))}`}
      </span>
      <span class="git-blame-num">${e.lineNumber}</span>
      <pre class="git-blame-line">${escapeHtml(e.lineContent)}</pre>
    `;
    body.appendChild(row);
  }
  h.appendChild(card);
}

// ---------------------------------------------------------------------------
// G13 — PR review (lightweight)
// ---------------------------------------------------------------------------

export async function showPrReview(repo: string, prNumber: number, gitPath: string): Promise<void> {
  const h = ensureHost();
  h.classList.remove('hidden');
  h.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'git-modal-card git-pr-card';
  card.innerHTML = `
    <div class="git-modal-header">
      <h3>PR #${prNumber}</h3>
      <button type="button" class="git-modal-close" aria-label="Close">×</button>
    </div>
    <div class="git-modal-body git-pr-body"><em>Loading…</em></div>
    <div class="git-modal-footer"></div>
  `;
  card.querySelector('.git-modal-close')!.addEventListener('click', close);
  h.appendChild(card);

  const body = card.querySelector('.git-pr-body') as HTMLElement;
  const footer = card.querySelector('.git-modal-footer') as HTMLElement;

  let detail: PRDetail;
  let files: PRFile[];
  let comments: PRComment[];
  try {
    [detail, files, comments] = await Promise.all([
      window.aiyard.github.prDetail(repo, prNumber),
      window.aiyard.github.prFiles(repo, prNumber),
      window.aiyard.github.prComments(repo, prNumber),
    ]);
  } catch (err) {
    body.innerHTML = `<em>Failed to load PR: ${escapeHtml(err instanceof Error ? err.message : String(err))}</em>`;
    return;
  }

  body.innerHTML = `
    <h4 class="git-pr-title">${escapeHtml(detail.title)}</h4>
    <p class="git-pr-meta">${escapeHtml(detail.author)} · ${escapeHtml(detail.head)} → ${escapeHtml(detail.base)} · ${detail.state}</p>
    <details><summary>Description</summary><pre>${escapeHtml(detail.body || '(no body)')}</pre></details>
    <div class="git-pr-files"></div>
    <div class="git-pr-review">
      <textarea class="git-pr-review-body" rows="3" placeholder="Top-level review comment (optional)"></textarea>
    </div>
  `;

  const filesEl = body.querySelector('.git-pr-files') as HTMLElement;
  for (const f of files) {
    const row = document.createElement('details');
    row.className = 'git-pr-file';
    row.innerHTML = `
      <summary><code>${escapeHtml(f.filename)}</code> +${f.additions} -${f.deletions} (${escapeHtml(f.status)})</summary>
      ${f.patch ? `<pre>${escapeHtml(f.patch)}</pre>` : '<em>(no patch — large file?)</em>'}
    `;
    const inlineFor = comments.filter((c) => c.path === f.filename);
    if (inlineFor.length > 0) {
      const list = document.createElement('div');
      list.className = 'git-pr-comments';
      list.innerHTML = inlineFor
        .map((c) => `<div class="git-pr-comment"><strong>${escapeHtml(c.user)}</strong> · L${c.line || '?'}: ${escapeHtml(c.body)}</div>`)
        .join('');
      row.appendChild(list);
    }
    filesEl.appendChild(row);
  }

  const reviewBody = body.querySelector('.git-pr-review-body') as HTMLTextAreaElement;
  const make = (event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES', label: string, variant?: 'primary' | 'danger') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `git-modal-btn${variant ? ` ${variant}` : ''}`;
    b.textContent = label;
    b.addEventListener('click', async () => {
      try {
        await window.aiyard.github.submitReview(repo, prNumber, event, reviewBody.value || ' ');
        alert(`Review submitted: ${label}`);
        close();
      } catch (err) {
        alert(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    return b;
  };
  footer.appendChild(make('COMMENT', 'Comment'));
  footer.appendChild(make('APPROVE', 'Approve', 'primary'));
  footer.appendChild(make('REQUEST_CHANGES', 'Request changes', 'danger'));

  const aiBtn = document.createElement('button');
  aiBtn.type = 'button';
  aiBtn.className = 'git-modal-btn';
  aiBtn.textContent = '✨ AI review';
  aiBtn.addEventListener('click', async () => {
    aiBtn.disabled = true;
    aiBtn.textContent = '✨ …';
    const fileSummaries = files.slice(0, 30).map((f) => `### ${f.filename} (+${f.additions} -${f.deletions})\n${f.patch || ''}`).join('\n\n');
    const prompt = [
      `You are reviewing a GitHub pull request titled "${detail.title}".`,
      `Branch: ${detail.head} → ${detail.base}`,
      'Identify potential bugs, missing tests, regressions, and clarity issues.',
      'Be concise. Use bullet points. Skip nitpicks.',
      '',
      'Diff:',
      fileSummaries.slice(0, 18_000),
    ].join('\n');
    const response = await window.aiyard.ai.callOnce(prompt, gitPath);
    if (response) {
      reviewBody.value = response;
    } else {
      alert('AI review failed.');
    }
    aiBtn.disabled = false;
    aiBtn.textContent = '✨ AI review';
  });
  footer.appendChild(aiBtn);
}

export { close as closeGitExtras };
