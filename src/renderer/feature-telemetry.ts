/**
 * Renderer-side helper for `feature.used` telemetry events.
 *
 * Two granularities:
 *   - `trackMount(surface)` — fires once per surface per app launch (uses an in-memory Set).
 *     Tells the dashboard which surfaces users actually open.
 *   - `trackInteraction(surface, action)` — fires every call. Tells the dashboard
 *     which actions inside a surface get used.
 *
 * Both delegate to `window.aiyard.telemetry.track`, which is fire-and-forget and
 * a no-op when the user has telemetry disabled (the main process gates it).
 */

export type FeatureSurface = 'kanban' | 'team' | 'browser-tab' | 'overview';

const mountedSurfaces = new Set<FeatureSurface>();

export function trackMount(surface: FeatureSurface): void {
  if (mountedSurfaces.has(surface)) return;
  mountedSurfaces.add(surface);
  try {
    window.aiyard.telemetry.track('feature.used', { surface, kind: 'mount' });
  } catch {
    // Defensive: in tests or before preload finishes, window.aiyard may be
    // partially defined. Telemetry must never throw to its callers.
  }
}

export function trackInteraction(surface: FeatureSurface, action: string): void {
  try {
    window.aiyard.telemetry.track('feature.used', { surface, kind: 'interaction', action });
  } catch {
    // See above.
  }
}

/** Reset module state. Test-only; do not call from production code. */
export function _resetForTesting(): void {
  mountedSurfaces.clear();
}
