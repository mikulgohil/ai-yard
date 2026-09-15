/**
 * F5 multi-session broadcast UI.
 * Titlebar toggle + floating input bar + right-click session picker.
 * See docs/FEATURE_ROADMAP.md F5.
 */
import {
  clearBroadcastMembers,
  formatBroadcastPayload,
  getBroadcastMembers,
  isBroadcastBarOpen,
  isBroadcastMember,
  listBroadcastableSessions,
  onBroadcastChange,
  pruneBroadcastMembers,
  seedBroadcastFromActiveProject,
  setBroadcastBarOpen,
  setBroadcastMember,
  setBroadcastMembers,
} from '../broadcast-state.js';
import { appState } from '../state.js';

let bar: HTMLElement | null = null;
let input: HTMLInputElement | null = null;
let countEl: HTMLElement | null = null;
let toggleBtn: HTMLButtonElement | null = null;
let pickerMenu: HTMLElement | null = null;

function ensureBar(): HTMLElement {
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = 'broadcast-bar';
  bar.className = 'broadcast-bar hidden';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Broadcast input');

  const label = document.createElement('span');
  label.className = 'broadcast-bar-label';
  label.textContent = 'Broadcast';

  countEl = document.createElement('span');
  countEl.className = 'broadcast-bar-count';

  input = document.createElement('input');
  input.type = 'text';
  input.className = 'broadcast-bar-input';
  input.setAttribute('aria-label', 'Prompt to broadcast');
  input.placeholder = 'Send one prompt to selected sessions...';

  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'broadcast-bar-send modal-btn primary';
  sendBtn.textContent = 'Send';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'icon-btn broadcast-bar-close';
  closeBtn.setAttribute('aria-label', 'Close broadcast');
  closeBtn.textContent = '×';

  bar.appendChild(label);
  bar.appendChild(countEl);
  bar.appendChild(input);
  bar.appendChild(sendBtn);
  bar.appendChild(closeBtn);

  const host = document.getElementById('content-area') || document.body;
  host.appendChild(bar);

  sendBtn.addEventListener('click', () => { void sendBroadcast(); });
  closeBtn.addEventListener('click', () => setBroadcastBarOpen(false));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void sendBroadcast();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setBroadcastBarOpen(false);
    }
  });

  return bar;
}

function hidePicker(): void {
  pickerMenu?.remove();
  pickerMenu = null;
}

function showPicker(anchor: HTMLElement): void {
  hidePicker();
  pruneBroadcastMembers();
  const sessions = listBroadcastableSessions();
  const menu = document.createElement('div');
  menu.className = 'tab-context-menu broadcast-picker';
  menu.setAttribute('role', 'menu');
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 4}px`;

  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tab-context-menu-item disabled';
    empty.textContent = 'No CLI sessions in this project';
    menu.appendChild(empty);
  } else {
    const all = document.createElement('div');
    all.className = 'tab-context-menu-item';
    all.textContent = 'Select all';
    all.addEventListener('click', () => {
      setBroadcastMembers(sessions.map((s) => s.id));
      hidePicker();
    });
    menu.appendChild(all);

    const none = document.createElement('div');
    none.className = 'tab-context-menu-item';
    none.textContent = 'Select none';
    none.addEventListener('click', () => {
      clearBroadcastMembers();
      hidePicker();
    });
    menu.appendChild(none);

    const sep = document.createElement('div');
    sep.className = 'tab-context-menu-separator';
    menu.appendChild(sep);

    for (const session of sessions) {
      const row = document.createElement('label');
      row.className = 'tab-context-menu-item broadcast-picker-item';
      row.setAttribute('role', 'menuitemcheckbox');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isBroadcastMember(session.id);
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        setBroadcastMember(session.id, cb.checked);
      });
      const text = document.createElement('span');
      text.textContent = session.name || 'Unnamed';
      row.appendChild(cb);
      row.appendChild(text);
      row.addEventListener('click', (e) => {
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        setBroadcastMember(session.id, cb.checked);
      });
      menu.appendChild(row);
    }
  }

  document.body.appendChild(menu);
  pickerMenu = menu;
  requestAnimationFrame(() => {
    document.addEventListener('mousedown', (e) => {
      if (pickerMenu && !pickerMenu.contains(e.target as Node) && e.target !== anchor) {
        hidePicker();
      }
    }, { once: true });
  });
}

function sendBroadcast(): void {
  if (!input) return;
  const payload = formatBroadcastPayload(input.value);
  if (!payload) return;
  pruneBroadcastMembers();
  const ids = getBroadcastMembers();
  if (ids.length === 0) return;
  window.aiyard.pty.broadcast(ids, payload);
  input.value = '';
  input.focus();
}

function syncRings(): void {
  const active = isBroadcastBarOpen();
  const members = new Set(getBroadcastMembers());
  document.querySelectorAll<HTMLElement>('.terminal-pane[data-session-id]').forEach((el) => {
    const id = el.dataset.sessionId;
    el.classList.toggle('broadcast-target', active && !!id && members.has(id));
  });
  document.querySelectorAll<HTMLElement>('.session-tree-row[data-session-id]').forEach((el) => {
    const id = el.dataset.sessionId;
    el.classList.toggle('broadcast-target', active && !!id && members.has(id));
  });
  document.querySelectorAll<HTMLElement>('.tab-item[data-session-id]').forEach((el) => {
    const id = el.dataset.sessionId;
    el.classList.toggle('broadcast-target', active && !!id && members.has(id));
  });
}

function syncUi(): void {
  const el = ensureBar();
  const open = isBroadcastBarOpen();
  el.classList.toggle('hidden', !open);
  toggleBtn?.classList.toggle('active', open);
  toggleBtn?.setAttribute('aria-pressed', open ? 'true' : 'false');
  const n = getBroadcastMembers().length;
  if (countEl) countEl.textContent = n === 0 ? 'no sessions' : `${n} session${n === 1 ? '' : 's'}`;
  syncRings();
  if (open) input?.focus();
}

function openBroadcast(): void {
  pruneBroadcastMembers();
  if (getBroadcastMembers().length === 0) seedBroadcastFromActiveProject();
  setBroadcastBarOpen(true);
}

export function initBroadcastBar(): void {
  toggleBtn = document.getElementById('btn-broadcast') as HTMLButtonElement | null;
  ensureBar();
  syncUi();

  toggleBtn?.addEventListener('click', () => {
    if (isBroadcastBarOpen()) setBroadcastBarOpen(false);
    else openBroadcast();
  });
  toggleBtn?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!isBroadcastBarOpen()) openBroadcast();
    if (toggleBtn) showPicker(toggleBtn);
  });

  onBroadcastChange(syncUi);
  appState.on('session-removed', () => {
    pruneBroadcastMembers();
    syncUi();
  });
  appState.on('session-added', syncRings);
  appState.on('project-changed', () => {
    clearBroadcastMembers();
    setBroadcastBarOpen(false);
  });
  appState.on('state-loaded', syncUi);
}
