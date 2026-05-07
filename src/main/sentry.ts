import * as Sentry from '@sentry/electron/main';
import { app } from 'electron';
import * as os from 'os';
import * as path from 'path';
import { createSentryScrubbers } from '../shared/sentry-scrub';
import type { Preferences } from '../shared/types';
import { getSentryDsn } from './build-config';

/**
 * Sentry crash reporting — opt-in via Preferences.crashReportsEnabled.
 *
 * Activated only when ALL of:
 *   1. App is packaged (no spam in dev)
 *   2. preferences.crashReportsEnabled === true
 *   3. A DSN is available — either baked into ./build-config at build time
 *      (CI release.yml provides SENTRY_DSN) or set via process.env.SENTRY_DSN
 *      at runtime (dev launches).
 *
 * If any condition fails, this is a complete no-op. The user controls #2 from
 * Preferences; #3 is set by the build pipeline (preferred) or the local shell.
 *
 * Toggling the preference at runtime currently requires an app restart — Sentry
 * has no clean shutdown path that releases all hooks. Documented in IMPROVEMENTS.md D14.
 */

let initialized = false;

export function initSentry(prefs: Preferences): void {
  if (initialized) return;
  if (!app.isPackaged) return;
  if (prefs.crashReportsEnabled !== true) return;

  const dsn = getSentryDsn();
  if (!dsn) return;

  const { scrubEvent, scrubBreadcrumb } = createSentryScrubbers({
    homeDir: os.homedir(),
    stateDir: path.join(os.homedir(), '.ai-yard'),
  });

  Sentry.init({
    dsn,
    release: app.getVersion(),
    environment: 'production',
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

export function isSentryInitialized(): boolean {
  return initialized;
}
