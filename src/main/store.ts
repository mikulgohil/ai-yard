import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { PersistedState } from '../shared/types';
import { CURRENT_VERSION, runMigrations } from './store-migrations';

export type { PersistedState, Preferences, ProjectRecord, SessionRecord } from '../shared/types';

const STATE_DIR = path.join(os.homedir(), '.ai-yard');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function defaultState(): PersistedState {
  return {
    version: CURRENT_VERSION,
    projects: [],
    activeProjectId: null,
    preferences: { soundOnSessionWaiting: true, notificationsDesktop: true, debugMode: false, sessionHistoryEnabled: true, insightsEnabled: true, autoTitleEnabled: true, confirmCloseWorkingSession: true },
  };
}

export function loadState(): PersistedState {
  for (const file of [STATE_FILE, `${STATE_FILE}.tmp`]) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown> & { version?: number };
      const migrated = runMigrations(parsed);
      if (!migrated) {
        console.warn(`State at version ${parsed.version} cannot be migrated to ${CURRENT_VERSION}; skipping`);
        continue;
      }
      if (file !== STATE_FILE) {
        console.warn('Recovered state from temp file');
      }
      return migrated;
    } catch {
    }
  }
  console.warn('No valid state file found, using defaults');
  return defaultState();
}

export function saveState(state: PersistedState): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  lastState = state;
  saveTimer = setTimeout(() => {
    writeStateAtomically(state);
    saveTimer = null;
  }, 300);
}

let lastState: PersistedState | null = null;

export function flushState(): void {
  if (lastState) {
    saveStateSync(lastState);
  }
}

export function saveStateSync(state: PersistedState): void {
  writeStateAtomically(state);
}

function writeStateAtomically(state: PersistedState): void {
  try {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    const tmpFile = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpFile, STATE_FILE);
  } catch (err) {
    console.error('Failed to save state:', err);
  }
}
