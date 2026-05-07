import * as Sentry from '@sentry/electron/renderer';
import { createSentryScrubbers } from '../shared/sentry-scrub.js';
import type { Preferences } from '../shared/types.js';

/**
 * Renderer-side Sentry crash reporting — opt-in via Preferences.crashReportsEnabled.
 *
 * The renderer does not own the DSN — events are forwarded to the main process
 * over Electron's IPC bridge, which decides whether to actually send. We still
 * gate `Sentry.init()` on the toggle so we don't register global error handlers
 * when the user has opted out.
 *
 * Toggling at runtime requires an app restart (matches main-process gating).
 */

let initialized = false;

export interface InitRendererSentryArgs {
  prefs: Preferences;
  homeDir: string;
  stateDir: string;
}

export function initRendererSentry({ prefs, homeDir, stateDir }: InitRendererSentryArgs): void {
  if (initialized) return;
  if (prefs.crashReportsEnabled !== true) return;

  const { scrubEvent, scrubBreadcrumb } = createSentryScrubbers({ homeDir, stateDir });

  Sentry.init({
    sendDefaultPii: false,
    beforeSend(event) {
      return scrubEvent(event);
    },
    beforeBreadcrumb(crumb) {
      return scrubBreadcrumb(crumb);
    },
  });

  initialized = true;
}

export function isRendererSentryInitialized(): boolean {
  return initialized;
}

/** @internal Test-only */
export function _resetForTesting(): void {
  initialized = false;
}
