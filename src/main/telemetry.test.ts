import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '../shared/types';

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '9.9.9',
  },
}));

const fetchMock = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal('fetch', fetchMock);

import { _resetForTesting, initTelemetry, isTelemetryActive, track } from './telemetry';

const basePrefs: Preferences = {
  soundOnSessionWaiting: true,
  notificationsDesktop: true,
  debugMode: false,
  sessionHistoryEnabled: true,
  insightsEnabled: true,
  autoTitleEnabled: true,
  confirmCloseWorkingSession: true,
};

describe('initTelemetry', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    _resetForTesting();
    process.env.TELEMETRY_ENDPOINT = 'https://umami.example.com/api/send';
    process.env.TELEMETRY_WEBSITE_ID = 'site-uuid';
  });

  afterEach(() => {
    delete process.env.TELEMETRY_ENDPOINT;
    delete process.env.TELEMETRY_WEBSITE_ID;
  });

  it('does nothing when telemetryEnabled is false', () => {
    initTelemetry({ prefs: { ...basePrefs, telemetryEnabled: false } });
    expect(isTelemetryActive()).toBe(false);
    track('app.launch');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when telemetryEnabled is undefined', () => {
    initTelemetry({ prefs: basePrefs });
    expect(isTelemetryActive()).toBe(false);
  });

  it('does nothing when TELEMETRY_ENDPOINT is missing', () => {
    delete process.env.TELEMETRY_ENDPOINT;
    initTelemetry({ prefs: { ...basePrefs, telemetryEnabled: true } });
    expect(isTelemetryActive()).toBe(false);
    track('session.start');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when TELEMETRY_WEBSITE_ID is missing', () => {
    delete process.env.TELEMETRY_WEBSITE_ID;
    initTelemetry({ prefs: { ...basePrefs, telemetryEnabled: true } });
    expect(isTelemetryActive()).toBe(false);
  });

  it('activates when prefs are on and both env vars set', () => {
    initTelemetry({ prefs: { ...basePrefs, telemetryEnabled: true } });
    expect(isTelemetryActive()).toBe(true);
  });

  it('reuses an existing deviceId without invoking onDeviceIdGenerated', () => {
    const onGen = vi.fn();
    initTelemetry({
      prefs: { ...basePrefs, telemetryEnabled: true },
      deviceId: 'existing-id',
      onDeviceIdGenerated: onGen,
    });
    expect(onGen).not.toHaveBeenCalled();
  });

  it('generates a deviceId when none is provided and notifies the caller', () => {
    const onGen = vi.fn();
    initTelemetry({
      prefs: { ...basePrefs, telemetryEnabled: true },
      deviceId: null,
      onDeviceIdGenerated: onGen,
    });
    expect(onGen).toHaveBeenCalledTimes(1);
    expect(onGen.mock.calls[0][0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('is idempotent: a second init call is a no-op', () => {
    const onGen = vi.fn();
    initTelemetry({ prefs: { ...basePrefs, telemetryEnabled: true }, onDeviceIdGenerated: onGen });
    initTelemetry({ prefs: { ...basePrefs, telemetryEnabled: true }, onDeviceIdGenerated: onGen });
    expect(onGen).toHaveBeenCalledTimes(1);
  });
});

describe('track', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    _resetForTesting();
    process.env.TELEMETRY_ENDPOINT = 'https://umami.example.com/api/send';
    process.env.TELEMETRY_WEBSITE_ID = 'site-uuid';
  });

  afterEach(() => {
    delete process.env.TELEMETRY_ENDPOINT;
    delete process.env.TELEMETRY_WEBSITE_ID;
  });

  it('is a no-op before init', () => {
    track('app.launch');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs to the configured endpoint with Umami payload shape', () => {
    initTelemetry({ prefs: { ...basePrefs, telemetryEnabled: true }, deviceId: 'fixed-device' });
    track('app.launch', { providersAvailable: 'claude,codex', providerCount: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://umami.example.com/api/send');
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const body = JSON.parse(opts.body as string);
    expect(body.type).toBe('event');
    expect(body.payload.website).toBe('site-uuid');
    expect(body.payload.name).toBe('app.launch');
    expect(body.payload.data.providersAvailable).toBe('claude,codex');
    expect(body.payload.data.providerCount).toBe(2);
    expect(body.payload.data.deviceId).toBe('fixed-device');
    expect(body.payload.data.appVersion).toBe('9.9.9');
    expect(body.payload.data.platform).toBe(process.platform);
    expect(body.payload.data.sessionId).toMatch(/^[0-9a-f]{8}-/);
  });

  it('keeps the same sessionId across multiple track calls in the same launch', () => {
    initTelemetry({ prefs: { ...basePrefs, telemetryEnabled: true }, deviceId: 'fixed-device' });
    track('app.launch');
    track('session.start', { providerId: 'claude', resume: false });

    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(first.payload.data.sessionId).toBe(second.payload.data.sessionId);
  });

  it('swallows network failures', async () => {
    const failure = vi.fn().mockRejectedValue(new Error('boom'));
    vi.stubGlobal('fetch', failure);
    initTelemetry({ prefs: { ...basePrefs, telemetryEnabled: true }, deviceId: 'd' });
    expect(() => track('app.launch')).not.toThrow();
    // Restore for downstream tests
    vi.stubGlobal('fetch', fetchMock);
  });
});
