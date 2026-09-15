import { getStatus } from '../session-activity.js';
import { appState } from '../state.js';

const pickerBtn = document.getElementById('titlebar-project-picker')!;
const projectNameEl = document.getElementById('titlebar-project-name')!;
const breadcrumbProjectEl = document.getElementById('breadcrumb-project')!;
const breadcrumbSepEl = document.getElementById('breadcrumb-sep')!;
const breadcrumbContextEl = document.getElementById('breadcrumb-context')!;

let dropdownEl: HTMLElement | null = null;
let outsideHandler: ((e: MouseEvent) => void) | null = null;

function openDropdown(): void {
  if (dropdownEl) {
    closeDropdown();
    return;
  }

  const projects = appState.projects;
  const activeId = appState.activeProjectId;
  const rect = pickerBtn.getBoundingClientRect();

  dropdownEl = document.createElement('div');
  dropdownEl.className = 'titlebar-picker-dropdown';
  dropdownEl.style.cssText = `
    position: fixed;
    top: ${rect.bottom + 4}px;
    left: ${rect.left}px;
    min-width: ${Math.max(rect.width, 180)}px;
    z-index: 1000;
  `;

  if (projects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'titlebar-picker-empty';
    empty.textContent = 'No projects yet';
    dropdownEl.appendChild(empty);
  } else {
    for (const project of projects) {
      const item = document.createElement('button');
      item.className = 'titlebar-picker-item';
      item.type = 'button';
      if (project.id === activeId) item.classList.add('active');

      const dot = document.createElement('span');
      dot.className = 'titlebar-picker-item-dot';

      const name = document.createElement('span');
      name.className = 'titlebar-picker-item-name';
      name.textContent = project.name;

      const count = document.createElement('span');
      count.className = 'titlebar-picker-item-count';
      count.textContent = String(project.sessions.length);

      item.appendChild(dot);
      item.appendChild(name);
      item.appendChild(count);

      item.addEventListener('click', () => {
        appState.setActiveProject(project.id);
        closeDropdown();
      });

      dropdownEl.appendChild(item);
    }
  }

  document.body.appendChild(dropdownEl);
  dropdownEl.animate(
    [{ opacity: 0, transform: 'translateY(-6px) scale(0.97)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }],
    { duration: 180, easing: 'cubic-bezier(0.34,1.56,0.64,1)', fill: 'forwards' },
  );

  outsideHandler = (e: MouseEvent) => {
    if (!dropdownEl?.contains(e.target as Node) && e.target !== pickerBtn) {
      closeDropdown();
    }
  };
  requestAnimationFrame(() => document.addEventListener('mousedown', outsideHandler!));
}

function closeDropdown(): void {
  dropdownEl?.remove();
  dropdownEl = null;
  if (outsideHandler) {
    document.removeEventListener('mousedown', outsideHandler);
    outsideHandler = null;
  }
}

function updatePickerLabel(): void {
  const project = appState.activeProject;
  projectNameEl.textContent = project?.name ?? 'Projects';
}

const STATUS_COLOR: Record<string, string> = {
  working:   'var(--status-info)',
  waiting:   'var(--status-warn)',
  input:     'var(--status-warn)',
  completed: 'var(--status-success)',
  idle:      'var(--text-muted)',
};

function updateBreadcrumb(): void {
  const project = appState.activeProject;
  if (!project) {
    breadcrumbProjectEl.textContent = '';
    breadcrumbSepEl.style.display = 'none';
    breadcrumbContextEl.textContent = '';
    breadcrumbContextEl.removeAttribute('data-status');
    return;
  }

  const session = project.sessions.find(s => s.id === project.activeSessionId);
  if (!session) {
    breadcrumbProjectEl.textContent = '';
    breadcrumbSepEl.style.display = 'none';
    breadcrumbContextEl.textContent = '';
    breadcrumbContextEl.removeAttribute('data-status');
    return;
  }

  breadcrumbProjectEl.textContent = project.name;
  breadcrumbSepEl.style.display = '';

  const status = getStatus(session.id);
  const dot = `<span class="breadcrumb-status-dot" style="background:${STATUS_COLOR[status] ?? STATUS_COLOR.idle}"></span>`;
  const label = session.name || 'Session';
  // Worktree branch is constrained to [A-Za-z0-9_./-] at creation time, so
  // direct interpolation is safe here.
  const worktree = session.worktreePath && session.worktreeBranch
    ? `<span class="breadcrumb-worktree" title="Worktree branch">🌿 ${session.worktreeBranch}</span>`
    : '';
  breadcrumbContextEl.innerHTML = `${dot}${worktree}${label}`;
}

export function initTitlebar(): void {
  pickerBtn.addEventListener('click', openDropdown);

  const refresh = (): void => { updatePickerLabel(); updateBreadcrumb(); closeDropdown(); };

  appState.on('state-loaded', refresh);
  appState.on('project-added', updatePickerLabel);
  appState.on('project-removed', updatePickerLabel);
  appState.on('project-changed', refresh);
  appState.on('session-added', updateBreadcrumb);
  appState.on('session-removed', updateBreadcrumb);
  appState.on('session-changed', updateBreadcrumb);
  appState.on('layout-changed', updateBreadcrumb);
}
