import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Terminal } from '@xterm/xterm';
import { appState } from '../../state.js';
import { getTerminalTheme } from '../../terminal-theme.js';
import { attachClipboardCopyHandler, attachCopyOnSelect, loadWebglWithFallback } from '../terminal-utils.js';
import { type DevServerInstance, instances } from './instance.js';

/**
 * Dev-server pane — a lightweight xterm view that spawns a generic shell PTY
 * (no CLI provider involvement) and auto-types the resolved run command on
 * first attach. Closing the tab kills the PTY (handled by AppState's normal
 * session-removed flow plus `destroyDevServerPane` below).
 *
 * Compared to `terminal-pane.ts`, this strips out: provider hooks, cost +
 * context tracking, CSI-u Shift+Enter for Claude, file-drag handling, the
 * status bar. It only needs an xterm and a PTY pipe.
 */
export function createDevServerPane(sessionId: string, projectId: string, command: string): void {
  if (instances.has(sessionId)) return;

  const project = appState.projects.find((p) => p.id === projectId);
  const projectPath = project?.path;
  if (!projectPath) return;

  const element = document.createElement('div');
  element.className = 'dev-server-pane hidden';
  element.dataset.sessionId = sessionId;

  const xtermWrap = document.createElement('div');
  xtermWrap.className = 'xterm-wrap';
  element.appendChild(xtermWrap);

  const terminal = new Terminal({
    theme: getTerminalTheme(appState.preferences.theme),
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
    cursorBlink: true,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  const searchAddon = new SearchAddon();
  terminal.loadAddon(searchAddon);

  const writeToPty = (data: string): void => window.aiyard.pty.write(sessionId, data);
  attachClipboardCopyHandler(terminal, undefined, writeToPty);
  terminal.onData(writeToPty);

  const offData = window.aiyard.pty.onData((sid, data) => {
    if (sid !== sessionId) return;
    terminal.write(data);
    maybeAutoOpenUrl(sessionId, data);
  });
  const offExit = window.aiyard.pty.onExit((sid, exitCode) => {
    if (sid !== sessionId) return;
    const inst = instances.get(sessionId);
    if (!inst) return;
    inst.exited = true;
    terminal.write(`\r\n\x1b[2m[process exited with code ${exitCode}]\x1b[0m\r\n`);
  });

  const instance: DevServerInstance = {
    sessionId,
    projectId,
    command,
    element,
    terminal,
    fitAddon,
    searchAddon,
    spawned: false,
    exited: false,
    urlOpened: false,
    urlSniffBuffer: '',
    unsubscribe: () => {
      offData();
      offExit();
    },
  };
  instances.set(sessionId, instance);
}

const URL_SNIFF_BUFFER_LIMIT = 4096;
const ANSI_CSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const LOCALHOST_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s\x1b'"<>`]*)?/i;

/**
 * Watch the PTY stream for the first localhost URL the dev server prints
 * (Vite, Astro, Next, etc. all log "Local: http://localhost:NNNN/") and open
 * it in an in-app browser tab. Buffered across chunks so a URL split mid-line
 * still matches. Fires at most once per session — `addBrowserTabSession` then
 * dedupes by URL if the same address was already opened earlier.
 */
function maybeAutoOpenUrl(sessionId: string, chunk: string): void {
  const inst = instances.get(sessionId);
  if (!inst || inst.urlOpened) return;

  const next = inst.urlSniffBuffer + chunk;
  inst.urlSniffBuffer = next.length > URL_SNIFF_BUFFER_LIMIT
    ? next.slice(-URL_SNIFF_BUFFER_LIMIT)
    : next;

  const stripped = inst.urlSniffBuffer.replace(ANSI_CSI_RE, '');
  const match = stripped.match(LOCALHOST_URL_RE);
  if (!match) return;

  inst.urlOpened = true;
  inst.urlSniffBuffer = '';
  appState.addBrowserTabSession(inst.projectId, match[0]);
}

export function attachDevServerToContainer(sessionId: string, container: HTMLElement): void {
  const inst = instances.get(sessionId);
  if (!inst) return;
  if (inst.element.parentElement !== container) {
    container.appendChild(inst.element);
  }
  // Open xterm into its DOM only after the element is mounted; opening earlier
  // produces a 0×0 canvas that never recovers without a refit cycle.
  if (!inst.terminal.element) {
    const xtermWrap = inst.element.querySelector('.xterm-wrap') as HTMLElement | null;
    if (xtermWrap) {
      inst.terminal.open(xtermWrap);
      attachCopyOnSelect(inst.terminal);
      loadWebglWithFallback(inst.terminal);
    }
  }
}

export function showDevServerPane(sessionId: string, isSplit: boolean): void {
  const inst = instances.get(sessionId);
  if (!inst) return;
  inst.element.classList.remove('hidden');
  inst.element.classList.toggle('split', isSplit);

  if (!inst.spawned) spawnAndType(inst);

  requestAnimationFrame(() => {
    fitInstance(inst);
    inst.terminal.focus();
  });
}

export function hideAllDevServerPanes(): void {
  for (const inst of instances.values()) {
    inst.element.classList.add('hidden');
  }
}

export function destroyDevServerPane(sessionId: string): void {
  const inst = instances.get(sessionId);
  if (!inst) return;
  instances.delete(sessionId);
  inst.unsubscribe();
  // Best-effort kill — PTY may already be dead if user typed Ctrl+D.
  void window.aiyard.pty.kill(sessionId);
  inst.terminal.dispose();
  inst.element.remove();
}

export function fitAllVisibleDevServerPanes(): void {
  for (const inst of instances.values()) {
    if (!inst.element.classList.contains('hidden')) {
      fitInstance(inst);
    }
  }
}

function fitInstance(inst: DevServerInstance): void {
  try {
    inst.fitAddon.fit();
    const { cols, rows } = inst.terminal;
    window.aiyard.pty.resize(inst.sessionId, cols, rows);
  } catch {
    // Element not visible yet; the next renderLayout pass will refit.
  }
}

async function spawnAndType(inst: DevServerInstance): Promise<void> {
  if (inst.spawned) return;
  inst.spawned = true;

  const project = appState.projects.find((p) => p.id === inst.projectId);
  if (!project) return;

  await window.aiyard.pty.createShell(inst.sessionId, project.path);

  // Wait one frame for the shell prompt to render before injecting the
  // command — otherwise the line is visually swallowed by the prompt's
  // own redraw on most shells.
  requestAnimationFrame(() => {
    window.aiyard.pty.write(inst.sessionId, `${inst.command}\r`);
  });
}

export { getDevServerInstance } from './instance.js';
