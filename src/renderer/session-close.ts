import { closeModal, showConfirmDialog, showModal } from './components/modal.js';
import { getStatus } from './session-activity.js';
import { appState, type SessionRecord } from './state.js';

type WorktreeAction = 'keep' | 'removeDir' | 'removeAll';

/**
 * Three-option close dialog shown when a session has a managed worktree.
 * Default = `keep` so the user never loses agent work to a misclick.
 */
function showWorktreeDeleteDialog(
  session: SessionRecord,
  onConfirm: (action: WorktreeAction) => void,
): void {
  showModal(
    'Close session',
    [],
    () => {
      const checked = document.querySelector<HTMLInputElement>('input[name="wt-action"]:checked');
      const action = (checked?.value ?? 'keep') as WorktreeAction;
      closeModal();
      onConfirm(action);
    },
    { confirmLabel: 'Close session' },
  );

  const bodyEl = document.getElementById('modal-body')!;
  bodyEl.innerHTML = '';

  const intro = document.createElement('p');
  intro.style.cssText = 'margin:0 0 12px 0;color:var(--text-secondary);font-size:13px;line-height:1.5;';
  intro.textContent = `This session runs in worktree "${session.worktreeBranch ?? 'aiyard/...'}". Choose what to do with it.`;
  bodyEl.appendChild(intro);

  const options: Array<{ value: WorktreeAction; label: string; sub: string }> = [
    { value: 'keep', label: 'Keep worktree and branch', sub: 'Recommended — review the work later.' },
    { value: 'removeDir', label: 'Remove worktree directory, keep branch', sub: 'Frees disk space; commits stay reachable on the branch.' },
    { value: 'removeAll', label: 'Remove both worktree and branch', sub: 'Permanently discards uncommitted changes and the branch.' },
  ];

  for (const [i, opt] of options.entries()) {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:8px 0;cursor:pointer;';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'wt-action';
    input.value = opt.value;
    input.style.cssText = 'margin-top:3px;flex-shrink:0;';
    if (i === 0) input.checked = true;

    const text = document.createElement('div');
    const label = document.createElement('div');
    label.textContent = opt.label;
    label.style.cssText = 'font-size:13px;color:var(--text-primary);';
    const sub = document.createElement('div');
    sub.textContent = opt.sub;
    sub.style.cssText = 'font-size:12px;color:var(--text-muted);margin-top:2px;';
    text.appendChild(label);
    text.appendChild(sub);

    wrap.appendChild(input);
    wrap.appendChild(text);
    bodyEl.appendChild(wrap);
  }
}

function projectSessions(projectId: string): SessionRecord[] {
  return appState.projects.find((p) => p.id === projectId)?.sessions ?? [];
}

function isActive(sessionId: string): boolean {
  const status = getStatus(sessionId);
  return status === 'working' || status === 'input';
}

function confirmAndClose(
  sessions: SessionRecord[],
  targetIds: string[],
  remove: () => void,
): void {
  if (!appState.preferences.confirmCloseWorkingSession) {
    remove();
    return;
  }
  const targets = new Set(targetIds);
  const active = sessions.filter((s) => targets.has(s.id) && isActive(s.id));
  if (active.length === 0) {
    remove();
    return;
  }
  const isSingle = active.length === 1;
  showConfirmDialog(
    isSingle ? 'Close session' : 'Close sessions',
    isSingle
      ? `'${active[0].name}' is still active. Closing will interrupt it.`
      : `${active.length} sessions are still active. Closing will interrupt them.`,
    {
      confirmLabel: isSingle ? 'Close' : 'Close all',
      onConfirm: remove,
    },
  );
}

export function closeSessionWithConfirm(projectId: string, sessionId: string): void {
  const session = projectSessions(projectId).find((s) => s.id === sessionId);
  // Worktree-bound sessions get the 3-option cleanup dialog instead of the
  // generic active-session warning. The dialog is itself a confirm step, and
  // the "Remove both" copy explicitly warns about discarding work — so we
  // skip the redundant active-session prompt.
  if (session?.worktreeManaged) {
    showWorktreeDeleteDialog(session, (action) => {
      appState.removeSession(projectId, sessionId, { worktreeAction: action });
    });
    return;
  }
  confirmAndClose(
    projectSessions(projectId),
    [sessionId],
    () => appState.removeSession(projectId, sessionId),
  );
}

export function closeSessionById(sessionId: string): void {
  const project = appState.projects.find((p) =>
    p.sessions.some((s) => s.id === sessionId),
  );
  if (project) appState.removeSession(project.id, sessionId);
}

export async function closeSessionIfFileMissing(sessionId: string, fullPath: string): Promise<boolean> {
  if (await window.aiyard.fs.exists(fullPath)) return false;
  closeSessionById(sessionId);
  return true;
}

export function closeAllSessionsWithConfirm(projectId: string): void {
  const sessions = projectSessions(projectId);
  confirmAndClose(
    sessions,
    sessions.map((s) => s.id),
    () => appState.removeAllSessions(projectId),
  );
}

export function closeOtherSessionsWithConfirm(projectId: string, sessionId: string): void {
  const sessions = projectSessions(projectId);
  confirmAndClose(
    sessions,
    sessions.filter((s) => s.id !== sessionId).map((s) => s.id),
    () => appState.removeOtherSessions(projectId, sessionId),
  );
}

export function closeSessionsFromRightWithConfirm(projectId: string, sessionId: string): void {
  const sessions = projectSessions(projectId);
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return;
  confirmAndClose(
    sessions,
    sessions.slice(idx + 1).map((s) => s.id),
    () => appState.removeSessionsFromRight(projectId, sessionId),
  );
}

export function closeSessionsFromLeftWithConfirm(projectId: string, sessionId: string): void {
  const sessions = projectSessions(projectId);
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return;
  confirmAndClose(
    sessions,
    sessions.slice(0, idx).map((s) => s.id),
    () => appState.removeSessionsFromLeft(projectId, sessionId),
  );
}

function countActiveSessions(): number {
  let count = 0;
  for (const project of appState.projects) {
    for (const session of project.sessions) {
      if (isActive(session.id)) count++;
    }
  }
  return count;
}

export function confirmAppClose(onConfirm: () => void): void {
  if (!appState.preferences.confirmCloseWorkingSession) {
    onConfirm();
    return;
  }
  const count = countActiveSessions();
  if (count === 0) {
    onConfirm();
    return;
  }
  const isSingle = count === 1;
  showConfirmDialog(
    'Quit AI-yard',
    isSingle
      ? 'A session is still active. Quitting will interrupt it.'
      : `${count} sessions are still active. Quitting will interrupt them.`,
    {
      confirmLabel: 'Quit',
      onConfirm,
    },
  );
}
