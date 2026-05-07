import type { PersistedState } from '../shared/types';

/**
 * The version of PersistedState that this build expects.
 *
 * When you change PersistedState's shape:
 *   1. Bump CURRENT_VERSION below.
 *   2. Add a migrator under `migrations` keyed by the *previous* version.
 *      e.g. CURRENT_VERSION goes 1 → 2 → register migrations[1].
 *   3. The migrator receives the old state, returns the new state including
 *      `version: <new version>`.
 *
 * See docs/IMPROVEMENTS.md D15 for context.
 */
export const CURRENT_VERSION = 1;

type AnyState = Record<string, unknown> & { version?: number };
type Migrator = (state: AnyState) => AnyState;

const migrations: Record<number, Migrator> = {
  // Example for the future, when CURRENT_VERSION = 2:
  // 1: (state) => ({ ...state, telemetryEnabled: false, version: 2 }),
};

/**
 * Walk the migration chain from `state.version` up to CURRENT_VERSION.
 * Returns the migrated state, or null if migration is impossible
 * (missing migrator, version is newer than this build, etc.).
 */
export function runMigrations(rawState: AnyState): PersistedState | null {
  const fromVersion = typeof rawState.version === 'number' ? rawState.version : 0;

  if (fromVersion > CURRENT_VERSION) {
    // The state file was written by a newer build of the app. We must not silently
    // downgrade — the user could lose data or break invariants the newer build relied on.
    return null;
  }

  if (fromVersion === CURRENT_VERSION) {
    return rawState as unknown as PersistedState;
  }

  let current = rawState;
  for (let v = fromVersion; v < CURRENT_VERSION; v++) {
    const migrator = migrations[v];
    if (!migrator) {
      // Gap in the migration chain — refuse rather than corrupt.
      return null;
    }
    current = migrator(current);
  }

  return current as unknown as PersistedState;
}
