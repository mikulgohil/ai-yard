import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { initSession, removeSession } from '../session-activity.js';
import { removeSession as removeCostSession } from '../session-cost.js';

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  element: HTMLDivElement;
  sessionId: string;
  projectPath: string;
  claudeSessionId: string | null;
  args: string;
  isResume: boolean;
  spawned: boolean;
  exited: boolean;
}

const instances = new Map<string, TerminalInstance>();
let focusedSessionId: string | null = null;

export function createTerminalPane(
  sessionId: string,
  projectPath: string,
  claudeSessionId: string | null,
  isResume: boolean = false,
  args: string = ''
): TerminalInstance {
  if (instances.has(sessionId)) {
    return instances.get(sessionId)!;
  }

  const element = document.createElement('div');
  element.className = 'terminal-pane hidden';
  element.dataset.sessionId = sessionId;

  const xtermWrap = document.createElement('div');
  xtermWrap.className = 'xterm-wrap';
  element.appendChild(xtermWrap);

  const costBar = document.createElement('div');
  costBar.className = 'session-cost-bar hidden';
  element.appendChild(costBar);

  const terminal = new Terminal({
    theme: {
      background: '#1a1a2e',
      foreground: '#e0e0e0',
      cursor: '#e94560',
      selectionBackground: '#e9456040',
      black: '#1a1a2e',
      red: '#e94560',
      green: '#0f9b58',
      yellow: '#f4b400',
      blue: '#4285f4',
      magenta: '#ab47bc',
      cyan: '#00acc1',
      white: '#e0e0e0',
    },
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
    cursorBlink: true,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  const instance: TerminalInstance = {
    terminal,
    fitAddon,
    element,
    sessionId,
    projectPath,
    claudeSessionId,
    args,
    isResume,
    spawned: false,
    exited: false,
  };

  instances.set(sessionId, instance);

  // Handle user input → PTY
  terminal.onData((data) => {
    window.claudeIde.pty.write(sessionId, data);
  });

  // Focus tracking
  element.addEventListener('mousedown', () => {
    setFocused(sessionId);
  });
  terminal.onData(() => {
    if (focusedSessionId !== sessionId) {
      setFocused(sessionId);
    }
  });

  return instance;
}

export function getTerminalInstance(sessionId: string): TerminalInstance | undefined {
  return instances.get(sessionId);
}

export function getAllInstances(): Map<string, TerminalInstance> {
  return instances;
}

export async function spawnTerminal(sessionId: string): Promise<void> {
  const instance = instances.get(sessionId);
  if (!instance || instance.spawned) return;

  instance.spawned = true;
  instance.exited = false;

  // Remove any exit overlay
  const overlay = instance.element.querySelector('.terminal-exit-overlay');
  if (overlay) overlay.remove();

  initSession(sessionId);
  await window.claudeIde.pty.create(sessionId, instance.projectPath, instance.claudeSessionId, instance.isResume, instance.args);
  instance.isResume = true; // subsequent spawns (e.g. Restart Session) should resume
}

export function attachToContainer(sessionId: string, container: HTMLElement): void {
  const instance = instances.get(sessionId);
  if (!instance) return;

  const xtermWrap = instance.element.querySelector('.xterm-wrap')!;
  if (!xtermWrap.querySelector('.xterm')) {
    container.appendChild(instance.element);
    instance.terminal.open(xtermWrap as HTMLElement);

    // Try WebGL, fall back silently
    try {
      const webglAddon = new WebglAddon();
      instance.terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not available, software renderer works fine
    }
  } else if (!container.contains(instance.element)) {
    container.appendChild(instance.element);
  }
}

export function showPane(sessionId: string, split: boolean): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.classList.remove('hidden');
  if (split) {
    instance.element.classList.add('split');
  } else {
    instance.element.classList.remove('split');
  }
}

export function hidePane(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.classList.add('hidden');
}

export function hideAllPanes(): void {
  for (const [, instance] of instances) {
    instance.element.classList.add('hidden');
  }
}

export function fitTerminal(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance || instance.element.classList.contains('hidden')) return;

  try {
    instance.fitAddon.fit();
    const { cols, rows } = instance.terminal;
    window.claudeIde.pty.resize(sessionId, cols, rows);
  } catch {
    // Element not yet visible
  }
}

export function fitAllVisible(): void {
  for (const [sessionId, instance] of instances) {
    if (!instance.element.classList.contains('hidden')) {
      fitTerminal(sessionId);
    }
  }
}

export function setFocused(sessionId: string): void {
  focusedSessionId = sessionId;
  for (const [id, instance] of instances) {
    if (id === sessionId) {
      instance.element.classList.add('focused');
      instance.terminal.focus();
    } else {
      instance.element.classList.remove('focused');
    }
  }
}

export function handlePtyData(sessionId: string, data: string): void {
  const instance = instances.get(sessionId);
  if (instance) {
    instance.terminal.write(data);
  }
}

export function handlePtyExit(sessionId: string, exitCode: number): void {
  const instance = instances.get(sessionId);
  if (!instance) return;

  instance.exited = true;
  instance.spawned = false;

  const overlay = document.createElement('div');
  overlay.className = 'terminal-exit-overlay';
  overlay.innerHTML = `
    <div class="terminal-exit-message">
      <div>Session ended (exit code: ${exitCode})</div>
      <button class="respawn-btn">Restart Session</button>
    </div>
  `;
  overlay.querySelector('.respawn-btn')!.addEventListener('click', () => {
    overlay.remove();
    spawnTerminal(sessionId);
  });
  instance.element.appendChild(overlay);
}

export function destroyTerminal(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;

  window.claudeIde.pty.kill(sessionId);
  instance.terminal.dispose();
  instance.element.remove();
  instances.delete(sessionId);
  removeSession(sessionId);
  removeCostSession(sessionId);
}

export function updateCostDisplay(sessionId: string, cost: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  const bar = instance.element.querySelector('.session-cost-bar');
  if (!bar) return;
  bar.textContent = `Cost: ${cost}`;
  bar.classList.remove('hidden');
}
