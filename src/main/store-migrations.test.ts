import { describe, expect, it } from 'vitest';
import { CURRENT_VERSION, runMigrations } from './store-migrations';

describe('runMigrations', () => {
  it('passes through state already at the current version', () => {
    const state = { version: CURRENT_VERSION, projects: [], activeProjectId: null, preferences: {} };
    const result = runMigrations(state);
    expect(result).toEqual(state);
  });

  it('returns null for state newer than the current version (no silent downgrade)', () => {
    const state = { version: CURRENT_VERSION + 5, projects: [] };
    expect(runMigrations(state)).toBeNull();
  });

  it('returns null when version is missing entirely (treated as v0, gap to v1+)', () => {
    // With CURRENT_VERSION = 1 and no migrators registered, a state with no version
    // cannot be migrated up. This forces the loader to fall back to defaults rather
    // than guessing what schema the file followed.
    const state = { projects: [] };
    if (CURRENT_VERSION > 0) {
      expect(runMigrations(state)).toBeNull();
    }
  });

  it('returns null when there is a gap in the migration chain', () => {
    // Smoke test: state declares an older version but no migrator is registered for it.
    // When CURRENT_VERSION is 1, declaring version: 0 with no v0→v1 migrator should fail.
    const state = { version: 0, projects: [] };
    if (CURRENT_VERSION > 0) {
      expect(runMigrations(state)).toBeNull();
    }
  });

  it('preserves the full state shape during pass-through', () => {
    const state = {
      version: CURRENT_VERSION,
      projects: [{ id: 'p1', name: 'Test', path: '/x' }],
      activeProjectId: 'p1',
      preferences: { debugMode: true },
      board: { columns: [], tasks: [] },
    };
    expect(runMigrations(state)).toEqual(state);
  });
});
