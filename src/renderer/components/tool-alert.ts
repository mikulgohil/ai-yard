import { onToolAlert, type ToolAlert } from '../tools/missing-tool-detector.js';
import { dismissInsight } from '../session-insights.js';
import { appState } from '../state.js';
import { showAlertBanner, removeAlertBanner } from './alert-banner.js';

let pendingActionTimer: ReturnType<typeof setTimeout> | null = null;

export function initToolAlert(): void {
  onToolAlert((alert) => {
    if (appState.activeSession?.id !== alert.sessionId) return;
    requestAnimationFrame(() => showToolBanner(alert));
  });

  appState.on('session-removed', () => {
    clearPendingAction();
  });
}

function clearPendingAction(): void {
  if (pendingActionTimer !== null) {
    clearTimeout(pendingActionTimer);
    pendingActionTimer = null;
  }
}

function handleFixAction(alert: ToolAlert): void {
  const project = appState.activeProject;
  if (!project) return;

  const prompt = `The CLI tool "${alert.tool.name}" (${alert.tool.command}) is not installed on this system. It would provide ${alert.tool.description}. Please install it and verify the installation works.`;

  const session = appState.addSession(project.id, `Install ${alert.tool.name}`);
  if (!session) return;

  removeAlertBanner();

  clearPendingAction();
  pendingActionTimer = setTimeout(() => {
    pendingActionTimer = null;
    window.claudeIde.pty.write(session.id, prompt + '\r');
  }, 2000);
}

function showToolBanner(alert: ToolAlert): void {
  const insightId = `missing-tool:${alert.tool.command}`;

  showAlertBanner({
    className: 'insight-alert-info',
    icon: '\u2139',
    message: `"${alert.tool.name}" (${alert.tool.command}) is not installed. Install it for ${alert.tool.description}.`,
    cta: {
      label: 'Fix in New Session',
      onClick: () => handleFixAction(alert),
    },
    onDismiss: () => dismissInsight(alert.projectId, insightId),
  });
}
