import { appState, ProjectRecord } from '../state.js';
import {
  createTerminalPane,
  attachToContainer,
  showPane,
  hideAllPanes,
  fitAllVisible,
  setFocused,
  spawnTerminal,
  destroyTerminal,
  getTerminalInstance,
} from './terminal-pane.js';

const container = document.getElementById('terminal-container')!;

export function initSplitLayout(): void {
  appState.on('state-loaded', renderLayout);
  appState.on('project-changed', renderLayout);
  appState.on('session-added', onSessionAdded);
  appState.on('session-removed', onSessionRemoved);
  appState.on('session-changed', renderLayout);
  appState.on('layout-changed', renderLayout);

  // Refit on window resize
  window.addEventListener('resize', () => {
    requestAnimationFrame(fitAllVisible);
  });
}

function onSessionAdded(data: unknown): void {
  const { session } = data as { projectId: string; session: { id: string; claudeSessionId: string | null; args?: string } };
  const project = appState.activeProject;
  if (!project) return;

  // Create and spawn immediately
  createTerminalPane(session.id, project.path, session.claudeSessionId, false, session.args || '');
  renderLayout();

  // Spawn after layout is rendered so terminal has dimensions
  requestAnimationFrame(() => {
    spawnTerminal(session.id);
    fitAllVisible();
  });
}

function onSessionRemoved(data: unknown): void {
  const { sessionId } = data as { projectId: string; sessionId: string };
  destroyTerminal(sessionId);
  renderLayout();
}

export function renderLayout(): void {
  const project = appState.activeProject;

  if (!project || project.sessions.length === 0) {
    hideAllPanes();
    container.className = '';
    showEmptyState(project);
    return;
  }

  removeEmptyState();

  // Ensure all sessions have terminal instances
  for (const session of project.sessions) {
    if (!getTerminalInstance(session.id)) {
      createTerminalPane(session.id, project.path, session.claudeSessionId, !!session.claudeSessionId, session.args || '');
    }
  }

  hideAllPanes();

  if (project.layout.mode === 'split' && project.layout.splitPanes.length > 1) {
    renderSplitMode(project);
  } else {
    renderTabMode(project);
  }

  requestAnimationFrame(fitAllVisible);
}

function renderTabMode(project: ProjectRecord): void {
  container.className = '';

  const activeId = project.activeSessionId;
  if (!activeId) return;

  attachToContainer(activeId, container);
  showPane(activeId, false);
  setFocused(activeId);

  // Ensure spawned
  const instance = getTerminalInstance(activeId);
  if (instance && !instance.spawned && !instance.exited) {
    requestAnimationFrame(() => {
      spawnTerminal(activeId);
      fitAllVisible();
    });
  }
}

function renderSplitMode(project: ProjectRecord): void {
  container.className = `split-${project.layout.splitDirection}`;

  for (const paneId of project.layout.splitPanes) {
    attachToContainer(paneId, container);
    showPane(paneId, true);

    // Ensure spawned
    const instance = getTerminalInstance(paneId);
    if (instance && !instance.spawned && !instance.exited) {
      requestAnimationFrame(() => {
        spawnTerminal(paneId);
        fitAllVisible();
      });
    }
  }

  // Focus active session
  if (project.activeSessionId && project.layout.splitPanes.includes(project.activeSessionId)) {
    setFocused(project.activeSessionId);
  } else if (project.layout.splitPanes.length > 0) {
    setFocused(project.layout.splitPanes[0]);
  }
}

function showEmptyState(project: ProjectRecord | undefined): void {
  removeEmptyState();
  const el = document.createElement('div');
  el.className = 'empty-state';
  if (!project) {
    el.innerHTML = `
      <div>No project selected</div>
      <div class="hint">Create a project with the + button in the sidebar</div>
    `;
  } else {
    el.innerHTML = `
      <div>No sessions in "${project.name}"</div>
      <div class="hint">Create a session with the + button in the tab bar</div>
    `;
  }
  container.appendChild(el);
}

function removeEmptyState(): void {
  container.querySelector('.empty-state')?.remove();
}
