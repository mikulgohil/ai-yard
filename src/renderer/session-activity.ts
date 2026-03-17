export type SessionStatus = 'working' | 'waiting' | 'idle';

const IDLE_TIMEOUT_MS = 5000;

type StatusChangeCallback = (sessionId: string, status: SessionStatus) => void;

interface SessionState {
  status: SessionStatus;
  idleTimer: ReturnType<typeof setTimeout> | null;
  hookActive: boolean; // true once the first hook event has been received
}

const sessions = new Map<string, SessionState>();
const listeners: StatusChangeCallback[] = [];

function setStatus(sessionId: string, status: SessionStatus): void {
  const state = sessions.get(sessionId);
  if (!state || state.status === status) return;
  state.status = status;
  for (const cb of listeners) cb(sessionId, status);
}

/**
 * Called when a hook-based status event is received from the main process.
 * This is the authoritative source for working/waiting transitions.
 */
export function setHookStatus(sessionId: string, status: 'working' | 'waiting'): void {
  const state = sessions.get(sessionId);
  if (!state) return;

  state.hookActive = true;

  // Reset idle timer on any hook event
  if (state.idleTimer !== null) clearTimeout(state.idleTimer);
  state.idleTimer = null;

  setStatus(sessionId, status);
}

export function recordActivity(sessionId: string, _byteCount: number): void {
  const state = sessions.get(sessionId);
  if (!state) return;

  // PTY data is flowing — mark as working (fallback for missed hook events)
  if (state.status !== 'working') {
    setStatus(sessionId, 'working');
  }

  // Reset idle timeout — if no PTY data for a while, session may be dead
  if (state.idleTimer !== null) clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    state.idleTimer = null;
    if (!state.hookActive) {
      setStatus(sessionId, 'waiting');
    }
  }, IDLE_TIMEOUT_MS);
}

export function initSession(sessionId: string): void {
  sessions.set(sessionId, { status: 'working', idleTimer: null, hookActive: false });
  for (const cb of listeners) cb(sessionId, 'working');
}

export function setIdle(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (!state) return;
  if (state.idleTimer !== null) clearTimeout(state.idleTimer);
  state.idleTimer = null;
  setStatus(sessionId, 'idle');
}

export function removeSession(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (!state) return;
  if (state.idleTimer !== null) clearTimeout(state.idleTimer);
  sessions.delete(sessionId);
}

export function getStatus(sessionId: string): SessionStatus {
  return sessions.get(sessionId)?.status ?? 'idle';
}

export function onChange(callback: StatusChangeCallback): void {
  listeners.push(callback);
}
