import { appState, type SessionRecord } from '../state.js';

const railIconsEl = document.getElementById('feature-rail-icons')!;

interface RailItem {
  type: 'feature' | 'separator' | 'spacer';
  sessionType?: string;
  label?: string;
  icon?: string;
  onActivate?: () => void;
}

const ICON_OVERVIEW = `<svg viewBox="160 -800 640 640" width="16" height="16" fill="currentColor"><path d="M224.62-160q-26.85 0-45.74-18.88Q160-197.77 160-224.62v-510.76q0-26.85 18.88-45.74Q197.77-800 224.62-800h510.76q26.85 0 45.74 18.88Q800-762.23 800-735.38v510.76q0 26.85-18.88 45.74Q762.23-160 735.38-160H224.62ZM420-200v-260H200v235.38q0 10.77 6.92 17.7 6.93 6.92 17.7 6.92H420Zm40 0h275.38q10.77 0 17.7-6.92 6.92-6.93 6.92-17.7V-460H460v260ZM200-500h560v-235.38q0-10.77-6.92-17.7-6.93-6.92-17.7-6.92H224.62q-10.77 0-17.7 6.92-6.92 6.93-6.92 17.7V-500Z"/></svg>`;

const ICON_TERMINAL = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M4.5 6.5l2.5 2-2.5 2M8.5 10.5h3"/></svg>`;

const ICON_KANBAN = `<svg viewBox="160 -800 640 640" width="16" height="16" fill="currentColor"><path d="M300-300h40v-360h-40v360Zm320-80h40v-280h-40v280ZM460-500h40v-160h-40v160ZM224.62-160q-27.62 0-46.12-18.5Q160-197 160-224.62v-510.76q0-27.62 18.5-46.12Q197-800 224.62-800h510.76q27.62 0 46.12 18.5Q800-763 800-735.38v510.76q0 27.62-18.5 46.12Q763-160 735.38-160H224.62Zm0-40h510.76q9.24 0 16.93-7.69 7.69-7.69 7.69-16.93v-510.76q0-9.24-7.69-16.93-7.69-7.69-16.93-7.69H224.62q-9.24 0-16.93 7.69-7.69 7.69-7.69 16.93v510.76q0 9.24 7.69 16.93 7.69 7.69 16.93 7.69ZM200-760v560-560Z"/></svg>`;

const ICON_BROWSER = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M1.5 6.5h13"/><circle cx="4.5" cy="4.5" r="0.5" fill="currentColor"/><circle cx="7" cy="4.5" r="0.5" fill="currentColor"/></svg>`;

const ICON_TEAM = `<svg viewBox="100 -760 760 580" width="16" height="16" fill="currentColor"><path d="M103.85-215.38v-65.85q0-27.85 14.42-47.89 14.42-20.03 38.76-32.02 52.05-24.78 103.35-39.51 51.31-14.73 123.47-14.73 72.15 0 123.46 14.73 51.31 14.73 103.35 39.51 24.34 11.99 38.76 32.02 14.43 20.04 14.43 47.89v65.85h-560Zm640 0v-67.7q0-34.77-14.08-65.64-14.07-30.87-39.92-52.97 29.46 6 56.77 16.65 27.3 10.66 54 23.96 26 13.08 40.77 33.47 14.76 20.4 14.76 44.53v67.7h-112.3ZM298.92-539.69q-35.07-35.08-35.07-84.93 0-49.84 35.07-84.92 35.08-35.08 84.93-35.08 49.84 0 84.92 35.08t35.08 84.92q0 49.85-35.08 84.93-35.08 35.07-84.92 35.07-49.85 0-84.93-35.07Zm340.45 0q-35.25 35.07-84.75 35.07-2.54 0-6.47-.57-3.92-.58-6.46-1.27 20.33-24.9 31.24-55.24 10.92-30.34 10.92-63.01t-11.43-62.44q-11.42-29.77-30.73-55.62 3.23-1.15 6.46-1.5 3.23-.35 6.47-.35 49.5 0 84.75 35.08t35.25 84.92q0 49.85-35.25 84.93Z"/></svg>`;

const ICON_COST = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1v14M11 5c0-1.1-1.3-2-3-2S5 3.9 5 5s1.3 2 3 2 3 .9 3 2-1.3 2-3 2-3-.9-3-2"/></svg>`;

const ICON_DEVSERVER = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M4 2.5v11l9-5.5z" rx="1"/></svg>`;

function getActiveSessionType(project = appState.activeProject): string | null {
  if (!project) return null;
  const session = project.sessions.find((s: SessionRecord) => s.id === project.activeSessionId);
  // undefined type means a plain CLI session
  return session?.type ?? null;
}

const CLI_TYPES = new Set(['remote-terminal', 'mcp-inspector']);

function isActiveFeature(type: string): boolean {
  const project = appState.activeProject;
  if (!project) return false;
  const activeType = getActiveSessionType(project);
  if (type === 'project-tab') return activeType === 'project-tab';
  if (type === 'cli') return !activeType || CLI_TYPES.has(activeType as string);
  return activeType === type;
}

function activateFeature(type: string): void {
  const project = appState.activeProject;
  if (!project) return;

  if (type === 'project-tab') {
    appState.openProjectTab(project.id);
  } else if (type === 'kanban') {
    appState.openKanbanTab(project.id);
  } else if (type === 'team') {
    appState.openTeamTab(project.id);
  } else if (type === 'cost-dashboard') {
    appState.openCostDashboardTab(project.id);
  } else if (type === 'browser-tab') {
    const existing = project.sessions.find((s: SessionRecord) => s.type === 'browser-tab');
    if (existing) {
      appState.setActiveSession(project.id, existing.id);
    } else {
      appState.addBrowserTabSession(project.id);
    }
  } else if (type === 'cli') {
    const cli = project.sessions.find((s: SessionRecord) => !s.type || s.type === 'remote-terminal');
    if (cli) {
      appState.setActiveSession(project.id, cli.id);
    } else {
      const sessionNum = project.sessions.length + 1;
      appState.addSession(project.id, `Session ${sessionNum}`);
    }
  }
}

function buildRailItems(): RailItem[] {
  const project = appState.activeProject;
  const prefs = appState.preferences;

  const items: RailItem[] = [
    { type: 'feature', sessionType: 'project-tab', label: 'Overview', icon: ICON_OVERVIEW, onActivate: () => activateFeature('project-tab') },
    { type: 'feature', sessionType: 'cli',          label: 'Terminal', icon: ICON_TERMINAL, onActivate: () => activateFeature('cli') },
    { type: 'separator' },
    { type: 'feature', sessionType: 'kanban',        label: 'Kanban',   icon: ICON_KANBAN, onActivate: () => activateFeature('kanban') },
    { type: 'feature', sessionType: 'browser-tab',   label: 'Browser',  icon: ICON_BROWSER, onActivate: () => activateFeature('browser-tab') },
    { type: 'feature', sessionType: 'team',          label: 'Team',     icon: ICON_TEAM, onActivate: () => activateFeature('team') },
  ];

  if (prefs.costDashboardEnabled !== false) {
    items.push({ type: 'feature', sessionType: 'cost-dashboard', label: 'Cost', icon: ICON_COST, onActivate: () => activateFeature('cost-dashboard') });
  }

  if (project?.runCommand) {
    items.push({ type: 'spacer' });
    items.push({ type: 'feature', sessionType: 'dev-server', label: 'Dev Server', icon: ICON_DEVSERVER, onActivate: () => activateFeature('dev-server') });
  }

  return items;
}

function render(): void {
  railIconsEl.innerHTML = '';

  for (const item of buildRailItems()) {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'rail-separator';
      sep.setAttribute('role', 'separator');
      railIconsEl.appendChild(sep);
      continue;
    }

    if (item.type === 'spacer') {
      const spacer = document.createElement('div');
      spacer.className = 'rail-spacer';
      railIconsEl.appendChild(spacer);
      continue;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rail-icon-btn';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('data-label', item.label!);
    btn.setAttribute('title', item.label!);
    btn.setAttribute('aria-label', item.label!);
    btn.innerHTML = item.icon!;

    if (item.sessionType && isActiveFeature(item.sessionType)) {
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
    } else {
      btn.setAttribute('aria-selected', 'false');
    }

    btn.addEventListener('click', () => {
      item.onActivate?.();
    });

    railIconsEl.appendChild(btn);
  }
}

export function initFeatureRail(): void {
  render();

  appState.on('state-loaded', render);
  appState.on('project-changed', render);
  appState.on('session-added', render);
  appState.on('session-removed', render);
  appState.on('session-changed', render);
  appState.on('layout-changed', render);
  appState.on('preferences-changed', render);
}
