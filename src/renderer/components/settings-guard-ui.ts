import type { SettingsWarningData } from '../../shared/types';
import { removeAlertBanner, showAlertBanner } from './alert-banner.js';
import { showStatusLineConflictModal } from './statusline-conflict-modal.js';

let initialized = false;

export function initSettingsGuard(): void {
  if (initialized) return;
  initialized = true;

  window.aiyard.settings.onConflictDialog((data) => {
    showStatusLineConflictModal(data.foreignCommand).then((choice) => {
      window.aiyard.settings.respondConflictDialog(choice);
    });
  });

  window.aiyard.settings.onWarning((data: SettingsWarningData) => {
    const hasStatusLineIssue = data.statusLine !== 'aiyard';
    const hasHooksIssue = data.hooks !== 'complete';

    if (!hasStatusLineIssue && !hasHooksIssue) return;

    let message: string;
    if (hasStatusLineIssue && hasHooksIssue) {
      message = 'AI-yard settings are missing from Claude Code. Cost tracking and session activity may not work.';
    } else if (hasStatusLineIssue) {
      message = data.statusLine === 'foreign'
        ? 'Another tool has overwritten AI-yard\'s statusLine setting. Cost tracking is unavailable.'
        : 'Cost tracking is unavailable \u2014 AI-yard\'s statusLine setting is not configured in Claude Code.';
    } else {
      message = 'Some session tracking hooks are missing from Claude Code settings. Activity tracking may not work.';
    }

    showAlertBanner({
      icon: '\u26A0',
      message,
      cta: {
        label: 'Fix Settings',
        onClick: async (btn) => {
          btn.disabled = true;
          btn.textContent = 'Fixing\u2026';
          const result = await window.aiyard.settings.reinstall();
          if (result.success) {
            removeAlertBanner();
          } else {
            btn.disabled = false;
            btn.textContent = 'Fix Settings';
          }
        },
      },
    });
  });
}
