import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '../shared/types';

const sentryInit = vi.fn();

vi.mock('@sentry/electron/renderer', () => ({
  init: (opts: unknown) => sentryInit(opts),
}));

import { _resetForTesting, initRendererSentry, isRendererSentryInitialized } from './sentry';

const basePrefs: Preferences = {
  soundOnSessionWaiting: true,
  notificationsDesktop: true,
  debugMode: false,
  sessionHistoryEnabled: true,
  insightsEnabled: true,
  autoTitleEnabled: true,
  confirmCloseWorkingSession: true,
};

const paths = { homeDir: '/Users/mock-user', stateDir: '/Users/mock-user/.ai-yard' };

describe('initRendererSentry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
  });

  it('does nothing when crashReportsEnabled is false', () => {
    initRendererSentry({ prefs: { ...basePrefs, crashReportsEnabled: false }, homeDir: paths.homeDir, stateDir: paths.stateDir });
    expect(sentryInit).not.toHaveBeenCalled();
    expect(isRendererSentryInitialized()).toBe(false);
  });

  it('does nothing when crashReportsEnabled is undefined', () => {
    initRendererSentry({ prefs: basePrefs, homeDir: paths.homeDir, stateDir: paths.stateDir });
    expect(sentryInit).not.toHaveBeenCalled();
    expect(isRendererSentryInitialized()).toBe(false);
  });

  it('initializes when crashReportsEnabled is true', () => {
    initRendererSentry({ prefs: { ...basePrefs, crashReportsEnabled: true }, homeDir: paths.homeDir, stateDir: paths.stateDir });
    expect(sentryInit).toHaveBeenCalledTimes(1);
    const opts = sentryInit.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.sendDefaultPii).toBe(false);
    expect(typeof opts.beforeSend).toBe('function');
    expect(typeof opts.beforeBreadcrumb).toBe('function');
    expect(isRendererSentryInitialized()).toBe(true);
  });

  it('only initializes once even on repeated calls', () => {
    initRendererSentry({ prefs: { ...basePrefs, crashReportsEnabled: true }, homeDir: paths.homeDir, stateDir: paths.stateDir });
    initRendererSentry({ prefs: { ...basePrefs, crashReportsEnabled: true }, homeDir: paths.homeDir, stateDir: paths.stateDir });
    expect(sentryInit).toHaveBeenCalledTimes(1);
  });

  it('beforeSend scrubs home-directory paths from stack frames', () => {
    initRendererSentry({ prefs: { ...basePrefs, crashReportsEnabled: true }, homeDir: paths.homeDir, stateDir: paths.stateDir });
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
    const scrubbed = opts.beforeSend(event) as unknown as typeof event;
    expect(scrubbed.exception.values[0].value).toBe('Boom in ~/Developer/foo.ts');
    expect(scrubbed.exception.values[0].stacktrace.frames[0].filename).toBe('<state>/state.json');
    expect(scrubbed.exception.values[0].stacktrace.frames[0].abs_path).toBe('~/Developer/x.ts');
  });

  it('beforeBreadcrumb scrubs message paths', () => {
    initRendererSentry({ prefs: { ...basePrefs, crashReportsEnabled: true }, homeDir: paths.homeDir, stateDir: paths.stateDir });
    const opts = sentryInit.mock.calls[0][0] as { beforeBreadcrumb: (c: unknown) => unknown };
    const crumb = { message: 'opened /Users/mock-user/Developer/x.ts' };
    const scrubbed = opts.beforeBreadcrumb(crumb) as unknown as typeof crumb;
    expect(scrubbed.message).toBe('opened ~/Developer/x.ts');
  });
});
