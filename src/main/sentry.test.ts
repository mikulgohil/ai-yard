import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '../shared/types';

const sentryInit = vi.fn();

vi.mock('@sentry/electron/main', () => ({
  init: (opts: unknown) => sentryInit(opts),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '1.2.3',
  },
}));

vi.mock('os', () => ({
  homedir: () => '/Users/mock-user',
}));

import { initSentry } from './sentry';

const basePrefs: Preferences = {
  soundOnSessionWaiting: true,
  notificationsDesktop: true,
  debugMode: false,
  sessionHistoryEnabled: true,
  insightsEnabled: true,
  autoTitleEnabled: true,
  confirmCloseWorkingSession: true,
};

describe('initSentry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SENTRY_DSN;
    // Reset the module's `initialized` flag by re-importing — Vitest preserves module state.
    // The simplest workaround: rely on the fact that each test only calls initSentry once
    // before the assertions, then clears the mock for the next test. The `initialized` flag
    // does prevent double-init within a process; we test that separately.
  });

  it('does nothing when crashReportsEnabled is false', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
    initSentry({ ...basePrefs, crashReportsEnabled: false });
    expect(sentryInit).not.toHaveBeenCalled();
  });

  it('does nothing when crashReportsEnabled is undefined', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
    initSentry(basePrefs);
    expect(sentryInit).not.toHaveBeenCalled();
  });

  it('does nothing when SENTRY_DSN env var is missing', () => {
    initSentry({ ...basePrefs, crashReportsEnabled: true });
    expect(sentryInit).not.toHaveBeenCalled();
  });

  it('initializes when both preference is on and DSN is set', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
    initSentry({ ...basePrefs, crashReportsEnabled: true });
    expect(sentryInit).toHaveBeenCalledTimes(1);
    const opts = sentryInit.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.dsn).toBe('https://example@sentry.io/1');
    expect(opts.release).toBe('1.2.3');
    expect(opts.sendDefaultPii).toBe(false);
    expect(typeof opts.beforeSend).toBe('function');
  });

  it('beforeSend scrubs home-directory paths from stack frames', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
    // Need a fresh module to reset `initialized` flag from prior test.
    vi.resetModules();
    return import('./sentry').then(({ initSentry: freshInit }) => {
      freshInit({ ...basePrefs, crashReportsEnabled: true });
      const opts = sentryInit.mock.calls[0][0] as { beforeSend: (e: unknown) => unknown };
      const event = {
        exception: {
          values: [
            {
              value: 'Boom in /Users/mock-user/Developer/foo.ts',
              stacktrace: {
                frames: [{ filename: '/Users/mock-user/.ai-yard/state.json', abs_path: '/Users/mock-user/Developer/x.ts' }],
              },
            },
          ],
        },
      };
      const scrubbed = opts.beforeSend(event) as typeof event;
      expect(scrubbed.exception.values[0].value).toBe('Boom in ~/Developer/foo.ts');
      expect(scrubbed.exception.values[0].stacktrace.frames[0].filename).toBe('<state>/state.json');
      expect(scrubbed.exception.values[0].stacktrace.frames[0].abs_path).toBe('~/Developer/x.ts');
    });
  });
});
