import * as crypto from 'crypto';
import { app } from 'electron';
import type { Preferences } from '../shared/types';
import { getTelemetryEndpoint, getTelemetryWebsiteId } from './build-config';

/**
 * Anonymous, opt-in usage telemetry — gated behind Preferences.telemetryEnabled.
 *
 * Activated only when ALL of:
 *   1. App is packaged (no spam in dev)
 *   2. preferences.telemetryEnabled === true
 *   3. A telemetry endpoint is available — either baked into ./build-config
 *      at build time (CI release.yml provides TELEMETRY_ENDPOINT, e.g.
 *      https://umami.example.com/api/send) or set via process.env at runtime.
 *   4. A telemetry website id is available — same dual baked/env source as #3
 *      via TELEMETRY_WEBSITE_ID (Umami website UUID).
 *
 * If any condition fails, every public function is a complete no-op. The
 * preference toggle requires an app restart — same constraint as Sentry.
 *
 * Privacy promise:
 *   - No PII is ever sent. No paths, no project names, no file contents.
 *   - `deviceId` is a randomly-generated UUID persisted in `~/.ai-yard/state.json`.
 *     Deleting state.json clears it. Hash-of-machine-id was considered but a
 *     persisted random UUID is functionally equivalent for analytics and avoids
 *     a native dependency.
 *   - `sessionId` is regenerated each app launch (in-memory only).
 *   - Both ids are anonymous; together they enable funnels (launch → session →
 *     feature.used) without ever identifying a user.
 *
 * Network:
 *   - Fire-and-forget POST with a 5s AbortController timeout.
 *   - Failures are silently swallowed — telemetry must never affect UX.
 */

let initialized = false;
let active = false;
let deviceId: string | null = null;
let sessionId: string | null = null;
let endpoint: string | null = null;
let websiteId: string | null = null;
let appVersion = '0.0.0';

export interface TelemetryInit {
  prefs: Preferences;
  /** Persisted device id from state, if any. Null/undefined means "generate one". */
  deviceId?: string | null;
  /** Called when a new device id was generated. The caller must persist it to state. */
  onDeviceIdGenerated?: (id: string) => void;
}

export function initTelemetry(input: TelemetryInit): void {
  if (initialized) return;
  initialized = true;

  if (!app.isPackaged) return;
  if (input.prefs.telemetryEnabled !== true) return;

  endpoint = getTelemetryEndpoint() ?? null;
  websiteId = getTelemetryWebsiteId() ?? null;
  if (!endpoint || !websiteId) return;

  if (input.deviceId && typeof input.deviceId === 'string') {
    deviceId = input.deviceId;
  } else {
    deviceId = crypto.randomUUID();
    input.onDeviceIdGenerated?.(deviceId);
  }
  sessionId = crypto.randomUUID();
  appVersion = app.getVersion();
  active = true;
}

export type TelemetryEvent = 'app.launch' | 'session.start' | 'feature.used';
export type TelemetryDataValue = string | number | boolean;

export function track(event: TelemetryEvent, data: Record<string, TelemetryDataValue> = {}): void {
  if (!active || !endpoint || !websiteId) return;

  const body = {
    type: 'event',
    payload: {
      website: websiteId,
      hostname: 'ai-yard.app',
      language: 'en-US',
      screen: '0x0',
      url: '/',
      referrer: '',
      name: event,
      data: {
        ...data,
        deviceId,
        sessionId,
        appVersion,
        platform: process.platform,
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': `ai-yard/${appVersion}` },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).catch(() => undefined).finally(() => clearTimeout(timer));
}

export function isTelemetryActive(): boolean {
  return active;
}

/** Reset module state. Test-only; do not call from production code. */
export function _resetForTesting(): void {
  initialized = false;
  active = false;
  deviceId = null;
  sessionId = null;
  endpoint = null;
  websiteId = null;
  appVersion = '0.0.0';
}
