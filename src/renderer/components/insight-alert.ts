import { onAlert, dismissInsight } from '../session-insights.js';
import { appState } from '../state.js';
import type { InsightResult } from '../insights/types.js';

let currentBanner: HTMLElement | null = null;

export function initInsightAlert(): void {
  onAlert((projectId, results) => {
    // Show only the first (most important) insight
    const result = results[0];
    if (!result) return;
    showBanner(projectId, result);
  });

  // Auto-remove banner on session switch
  appState.on('session-changed', () => {
    removeBanner();
  });
}

function showBanner(projectId: string, result: InsightResult): void {
  removeBanner();

  const activeSession = appState.activeSession;
  if (!activeSession) return;

  const pane = document.querySelector(`.terminal-pane[data-session-id="${activeSession.id}"]`);
  if (!pane) return;

  const banner = document.createElement('div');
  banner.className = 'insight-alert';

  const icon = document.createElement('span');
  icon.className = 'insight-alert-icon';
  icon.textContent = '\u26A0';

  const message = document.createElement('span');
  message.className = 'insight-alert-message';
  message.textContent = result.description;

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'insight-alert-dismiss';
  dismissBtn.textContent = "Don\u2019t show again";
  dismissBtn.addEventListener('click', () => {
    dismissInsight(projectId, result.id);
    removeBanner();
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'insight-alert-close';
  closeBtn.textContent = '\u00D7';
  closeBtn.addEventListener('click', () => {
    removeBanner();
  });

  banner.appendChild(icon);
  banner.appendChild(message);
  banner.appendChild(dismissBtn);
  banner.appendChild(closeBtn);

  // Prepend before .xterm-wrap
  const xtermWrap = pane.querySelector('.xterm-wrap');
  if (xtermWrap) {
    pane.insertBefore(banner, xtermWrap);
  } else {
    pane.prepend(banner);
  }

  currentBanner = banner;
}

function removeBanner(): void {
  if (currentBanner) {
    currentBanner.remove();
    currentBanner = null;
  }
}
