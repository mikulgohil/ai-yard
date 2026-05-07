import { hideDashboard, renderDashboard } from './dashboard-view.js';
import { type CostDashboardInstance, instances } from './instance.js';

export function createCostDashboardPane(sessionId: string, projectId: string): void {
  if (instances.has(sessionId)) return;

  const el = document.createElement('div');
  el.className = 'cost-dashboard-pane hidden';
  el.dataset.sessionId = sessionId;

  const instance: CostDashboardInstance = {
    sessionId,
    projectId,
    element: el,
    destroy() {
      el.remove();
    },
  };
  instances.set(sessionId, instance);
}

export function attachCostDashboardToContainer(sessionId: string, container: HTMLElement): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (instance.element.parentElement !== container) {
    container.appendChild(instance.element);
  }
}

export function showCostDashboardPane(sessionId: string, isSplit: boolean): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.classList.remove('hidden');
  instance.element.classList.toggle('split', isSplit);
  renderDashboard(instance.element);
}

export function hideAllCostDashboardPanes(): void {
  for (const instance of instances.values()) {
    instance.element.classList.add('hidden');
  }
  hideDashboard();
}

export function destroyCostDashboardPane(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instances.delete(sessionId);
  instance.destroy();
}

export { getCostDashboardInstance } from './instance.js';
