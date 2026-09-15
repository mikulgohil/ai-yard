/**
 * Ephemeral multi-session broadcast membership (F5).
 * Not persisted to state.json - resets each app launch.
 * See docs/FEATURE_ROADMAP.md F5.
 */
import type { SessionRecord } from '../shared/types.js';
import { isCliSession } from './session-utils.js';
import { appState } from './state.js';

const members = new Set<string>();
let barOpen = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

export function formatBroadcastPayload(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.endsWith('\r') ? trimmed : `${trimmed}\r`;
}

export function onBroadcastChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function isBroadcastBarOpen(): boolean {
  return barOpen;
}

export function setBroadcastBarOpen(open: boolean): void {
  if (barOpen === open) return;
  barOpen = open;
  notify();
}

export function getBroadcastMembers(): string[] {
  return [...members];
}

export function isBroadcastMember(sessionId: string): boolean {
  return members.has(sessionId);
}

export function setBroadcastMember(sessionId: string, on: boolean): void {
  const before = members.has(sessionId);
  if (on) members.add(sessionId);
  else members.delete(sessionId);
  if (before !== members.has(sessionId)) notify();
}

export function setBroadcastMembers(sessionIds: string[]): void {
  members.clear();
  for (const id of sessionIds) {
    if (id) members.add(id);
  }
  notify();
}

export function clearBroadcastMembers(): void {
  if (members.size === 0) return;
  members.clear();
  notify();
}

export function listBroadcastableSessions(): SessionRecord[] {
  const project = appState.activeProject;
  if (!project) return [];
  return project.sessions.filter((s) => isCliSession(s));
}

/** When opening broadcast with an empty set, include every CLI session in the project. */
export function seedBroadcastFromActiveProject(): void {
  const ids = listBroadcastableSessions().map((s) => s.id);
  setBroadcastMembers(ids);
}

export function pruneBroadcastMembers(): void {
  const alive = new Set(listBroadcastableSessions().map((s) => s.id));
  let changed = false;
  for (const id of [...members]) {
    if (!alive.has(id)) {
      members.delete(id);
      changed = true;
    }
  }
  if (changed) notify();
}
