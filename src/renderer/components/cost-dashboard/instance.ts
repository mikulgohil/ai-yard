export interface CostDashboardInstance {
  sessionId: string;
  projectId: string;
  element: HTMLElement;
  destroy(): void;
}

export const instances = new Map<string, CostDashboardInstance>();

export function getCostDashboardInstance(sessionId: string): CostDashboardInstance | undefined {
  return instances.get(sessionId);
}
