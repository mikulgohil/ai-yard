import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { FILE_PATH_DRAG_TYPE, NATIVE_FILES_DRAG_TYPE } from '../drag-types.js';
import { getProviderCapabilities } from '../provider-availability.js';
import { initSession, removeSession } from '../session-activity.js';
import { CONTEXT_BANNER_THRESHOLD, type ContextWindowInfo, getContextSeverity, removeSession as removeContextSession, shouldShowContextBanner } from '../session-context.js';
import { type CostInfo, formatTokens, removeSession as removeCostSession } from '../session-cost.js';
import { markFreshSession } from '../session-insights.js';
import { appState } from '../state.js';
import { getTerminalTheme } from '../terminal-theme.js';
import type { ThemeName } from '../theme.js';
import type { ProviderId } from '../types.js';
import { FilePathLinkProvider, GithubLinkProvider } from './terminal-link-provider.js';
import { attachClipboardCopyHandler, attachCopyOnSelect, loadWebglWithFallback, wrapBracketedPaste } from './terminal-utils.js';

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  element: HTMLDivElement;
  sessionId: string;
  projectPath: string;
  cliSessionId: string | null;
  providerId: ProviderId;
  args: string;
  isResume: boolean;
  wasResumed: boolean;
  spawned: boolean;
  exited: boolean;
  pendingPrompt: string | null;
  pendingSystemPrompt: string | null;
  pendingPromptTimer: ReturnType<typeof setTimeout> | null;
  contextBannerDismissed: boolean;
}

const instances = new Map<string, TerminalInstance>();
let focusedSessionId: string | null = null;

function buildContextIndicator(): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'context-indicator';

  const bar = document.createElement('div');
  bar.className = 'context-bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', '0');
  bar.setAttribute('aria-label', 'Context window usage');

  const fill = document.createElement('div');
  fill.className = 'context-bar-fill';
  fill.style.width = '0%';
  bar.appendChild(fill);

  const text = document.createElement('span');
  text.className = 'context-text';

  wrap.appendChild(bar);
  wrap.appendChild(text);
  return wrap;
}

function buildContextBanner(sessionId: string): HTMLDivElement {
  const banner = document.createElement('div');
  banner.className = 'context-banner hidden';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');

  const icon = document.createElement('span');
  icon.className = 'context-banner-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '!';

  const text = document.createElement('span');
  text.className = 'context-banner-text';

  const prefix = document.createElement('span');
  prefix.textContent = 'Context nearly full — type ';
  const code = document.createElement('code');
  code.textContent = '/compact';
  const suffix = document.createElement('span');
  suffix.textContent = ' to summarize';

  text.appendChild(prefix);
  text.appendChild(code);
  text.appendChild(suffix);

  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'context-banner-action';
  action.textContent = 'Run /compact';
  action.addEventListener('click', () => {
    window.aiyard.pty.write(sessionId, '/compact\r');
    const inst = instances.get(sessionId);
    if (inst) inst.contextBannerDismissed = true;
    banner.classList.add('hidden');
  });

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'context-banner-dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss context warning');
  dismiss.textContent = '×';
  dismiss.addEventListener('click', () => {
    const inst = instances.get(sessionId);
    if (inst) inst.contextBannerDismissed = true;
    banner.classList.add('hidden');
  });

  banner.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      const inst = instances.get(sessionId);
      if (inst) inst.contextBannerDismissed = true;
      banner.classList.add('hidden');
    }
  });

  banner.appendChild(icon);
  banner.appendChild(text);
  banner.appendChild(action);
  banner.appendChild(dismiss);
  return banner;
}

export function createTerminalPane(
  sessionId: string,
  projectPath: string,
  cliSessionId: string | null,
  isResume: boolean = false,
  args: string = '',
  providerId: ProviderId = 'claude',
  projectId?: string
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

  const banner = buildContextBanner(sessionId);
  element.appendChild(banner);

  const statusBar = document.createElement('div');
  statusBar.className = 'session-status-bar';
  const contextIndicator = buildContextIndicator();
  const costDisplay = document.createElement('div');
  costDisplay.className = 'cost-display';
  const caps = getProviderCapabilities(providerId);
  if (caps?.costTracking !== false) {
    costDisplay.textContent = '$0.0000';
  } else {
    costDisplay.classList.add('hidden');
  }
  contextIndicator.classList.toggle('hidden', caps?.contextWindow === false);
  if (caps?.contextWindow === false) banner.classList.add('hidden');
  statusBar.appendChild(contextIndicator);
  statusBar.appendChild(costDisplay);
  element.appendChild(statusBar);

  const terminal = new Terminal({
    theme: getTerminalTheme(appState.preferences.theme),
    fontSize: 14,
    fontFamily: "'FiraCode Nerd Font Mono', 'FiraCode Nerd Font', 'Fira Code', 'JetBrains Mono', 'SF Mono', Menlo, monospace",
    cursorBlink: true,
    allowProposedApi: true,
    linkHandler: {
      activate: (event, uri) => {
        if (event.metaKey || event.ctrlKey) {
          window.aiyard.app.openExternal(uri);
        }
      },
    },
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  const searchAddon = new SearchAddon();
  terminal.loadAddon(searchAddon);

  terminal.loadAddon(new WebLinksAddon((event, url) => {
    if (event.metaKey || event.ctrlKey) {
      window.aiyard.app.openExternal(url);
    }
  }));

  const writeToPty = (data: string) => window.aiyard.pty.write(sessionId, data);

  // Send CSI u encoding for Shift+Enter so Claude CLI treats it as newline
  attachClipboardCopyHandler(terminal, (e) => {
    if (e.shiftKey && e.key === 'Enter') {
      if (e.type === 'keydown') window.aiyard.pty.write(sessionId, '\x1b[13;2u');
      e.preventDefault();
      return false;
    }
  }, writeToPty);

  const instance: TerminalInstance = {
    terminal,
    fitAddon,
    searchAddon,
    element,
    sessionId,
    projectPath,
    cliSessionId,
    providerId,
    args,
    isResume,
    wasResumed: isResume,
    spawned: false,
    exited: false,
    pendingPrompt: null,
    pendingSystemPrompt: null,
    pendingPromptTimer: null,
    contextBannerDismissed: false,
  };

  instances.set(sessionId, instance);

  // Register file path link provider for Cmd+Click
  if (projectId) {
    terminal.registerLinkProvider(new FilePathLinkProvider(projectId, projectPath, terminal));
  }

  // Register GitHub #123 link provider
  window.aiyard.git.getRemoteUrl(projectPath).then((repoUrl) => {
    if (repoUrl) {
      terminal.registerLinkProvider(new GithubLinkProvider(repoUrl, terminal));
    }
  });

  // Handle user input → PTY
  terminal.onData((data) => {
    window.aiyard.pty.write(sessionId, data);
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

  element.addEventListener('dragover', (e: DragEvent) => {
    if (!e.dataTransfer) return;
    const types = e.dataTransfer.types;
    if (!types.includes(FILE_PATH_DRAG_TYPE) && !types.includes(NATIVE_FILES_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    element.classList.add('drag-over');
  });
  element.addEventListener('dragleave', (e: DragEvent) => {
    const next = e.relatedTarget as Node | null;
    if (!next || !element.contains(next)) {
      element.classList.remove('drag-over');
    }
  });
  element.addEventListener('drop', (e: DragEvent) => {
    element.classList.remove('drag-over');
    const paths = collectDroppedPaths(e.dataTransfer);
    if (paths.length === 0) return;
    e.preventDefault();
    if (injectTextIntoRunningSession(sessionId, `${paths.join(' ')} `)) {
      terminal.focus();
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

export function applyThemeToAllTerminals(theme: ThemeName): void {
  const termTheme = getTerminalTheme(theme);
  for (const instance of instances.values()) {
    instance.terminal.options.theme = termTheme;
  }
}

export function setPendingPrompt(sessionId: string, prompt: string): void {
  const instance = instances.get(sessionId);
  if (instance) {
    instance.pendingPrompt = prompt;
  }
}

export function setPendingSystemPrompt(sessionId: string, prompt: string): void {
  const instance = instances.get(sessionId);
  if (instance) {
    instance.pendingSystemPrompt = prompt;
  }
}

function collectDroppedPaths(dt: DataTransfer | null): string[] {
  if (!dt) return [];
  const internal = dt.getData(FILE_PATH_DRAG_TYPE);
  if (internal) return [internal];
  const paths: string[] = [];
  for (const file of dt.files) {
    const path = window.aiyard.fs.getDroppedFilePath(file);
    if (path) paths.push(path);
  }
  return paths;
}

export function injectTextIntoRunningSession(sessionId: string, text: string): boolean {
  const instance = instances.get(sessionId);
  if (!instance?.spawned || instance.exited) return false;
  window.aiyard.pty.write(sessionId, wrapBracketedPaste(instance.terminal, text));
  return true;
}

export function injectPromptIntoRunningSession(sessionId: string, prompt: string): boolean {
  if (!injectTextIntoRunningSession(sessionId, prompt)) return false;
  window.aiyard.pty.write(sessionId, '\r');
  return true;
}

function clearPendingPromptTimer(instance: TerminalInstance): void {
  if (instance.pendingPromptTimer) {
    clearTimeout(instance.pendingPromptTimer);
    instance.pendingPromptTimer = null;
  }
}


export async function spawnTerminal(sessionId: string): Promise<void> {
  const instance = instances.get(sessionId);
  if (!instance || instance.spawned) return;

  instance.spawned = true;
  instance.exited = false;

  // Remove any exit overlay
  const overlay = instance.element.querySelector('.terminal-exit-overlay');
  if (overlay) overlay.remove();

  if (!instance.isResume) {
    markFreshSession(sessionId);
  }
  initSession(sessionId);
  let initialPrompt: string | undefined;
  if (instance.pendingPrompt && getProviderCapabilities(instance.providerId)?.pendingPromptTrigger === 'startup-arg') {
    initialPrompt = instance.pendingPrompt;
    instance.pendingPrompt = null;
  }
  let systemPrompt: string | undefined;
  if (instance.pendingSystemPrompt) {
    systemPrompt = instance.pendingSystemPrompt;
    instance.pendingSystemPrompt = null;
  }
  await window.aiyard.pty.create(sessionId, instance.projectPath, instance.cliSessionId, instance.isResume, instance.args, instance.providerId, initialPrompt, systemPrompt);
  instance.isResume = true; // subsequent spawns (e.g. Restart Session) should resume
}

export function attachToContainer(sessionId: string, container: HTMLElement): void {
  const instance = instances.get(sessionId);
  if (!instance) return;

  const xtermWrap = instance.element.querySelector('.xterm-wrap')!;
  if (!xtermWrap.querySelector('.xterm')) {
    container.appendChild(instance.element);
    instance.terminal.open(xtermWrap as HTMLElement);

    attachCopyOnSelect(instance.terminal);
    loadWebglWithFallback(instance.terminal);
  } else {
    // Always re-append to ensure correct DOM order (appendChild moves existing children)
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
    instance.element.classList.remove('swarm-dimmed', 'swarm-unread');
  }
}

export function fitTerminal(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance || instance.element.classList.contains('hidden')) return;

  try {
    instance.fitAddon.fit();
    const { cols, rows } = instance.terminal;
    window.aiyard.pty.resize(sessionId, cols, rows);
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

export function getSearchAddon(sessionId: string): SearchAddon | undefined {
  return instances.get(sessionId)?.searchAddon;
}

export function getFocusedSessionId(): string | null {
  return focusedSessionId;
}

export function setFocused(sessionId: string): void {
  focusedSessionId = sessionId;

  // Only move DOM focus if it's currently on a session terminal (or nothing).
  // This prevents stealing focus from the project terminal panel, search bar, modals, etc.
  const activeEl = document.activeElement;
  const shouldFocusTerminal =
    !activeEl ||
    activeEl === document.body ||
    !!activeEl.closest('.terminal-pane');

  for (const [id, instance] of instances) {
    if (id === sessionId) {
      instance.element.classList.add('focused');
      if (shouldFocusTerminal) {
        instance.terminal.focus();
      }
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

export function destroyTerminal(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;

  clearPendingPromptTimer(instance);
  window.aiyard.pty.kill(sessionId);
  instance.terminal.dispose();
  instance.element.remove();
  instances.delete(sessionId);
  removeSession(sessionId);
  removeCostSession(sessionId);
  removeContextSession(sessionId);
}

function showStatusBar(instance: TerminalInstance): void {
  const bar = instance.element.querySelector('.session-status-bar');
  if (bar) bar.classList.remove('hidden');
}

export function updateCostDisplay(sessionId: string, cost: CostInfo): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (getProviderCapabilities(instance.providerId)?.costTracking === false) return;
  const el = instance.element.querySelector('.cost-display');
  if (!el) return;

  const costStr = `$${cost.totalCostUsd.toFixed(4)}`;
  const modelPrefix = cost.model ? `${cost.model}  \u00b7  ` : '';
  if (cost.totalInputTokens > 0 || cost.totalOutputTokens > 0) {
    el.textContent = `${modelPrefix}${costStr}  \u00b7  ${formatTokens(cost.totalInputTokens)} in / ${formatTokens(cost.totalOutputTokens)} out`;
    const durationSec = (cost.totalDurationMs / 1000).toFixed(1);
    const apiDurationSec = (cost.totalApiDurationMs / 1000).toFixed(1);
    (el as HTMLElement).title = `Cache read: ${formatTokens(cost.cacheReadTokens)} · Cache create: ${formatTokens(cost.cacheCreationTokens)} · Duration: ${durationSec}s · API: ${apiDurationSec}s`;
  } else {
    el.textContent = `${modelPrefix}${costStr}`;
    (el as HTMLElement).title = '';
  }
  showStatusBar(instance);
}

export function updateContextDisplay(sessionId: string, info: ContextWindowInfo): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (getProviderCapabilities(instance.providerId)?.contextWindow === false) return;
  const el = instance.element.querySelector('.context-indicator') as HTMLElement | null;
  if (!el) return;

  const pct = Math.min(Math.round(info.usedPercentage), 100);
  const tokenStr = formatTokens(info.totalTokens);
  const tooltip = `${info.totalTokens.toLocaleString()} / ${info.contextWindowSize.toLocaleString()} tokens`;

  const fill = el.querySelector('.context-bar-fill') as HTMLElement | null;
  const bar = el.querySelector('.context-bar') as HTMLElement | null;
  const text = el.querySelector('.context-text') as HTMLElement | null;
  if (fill) fill.style.width = `${pct}%`;
  if (bar) bar.setAttribute('aria-valuenow', String(pct));
  if (text) text.textContent = `${pct}% · ${tokenStr}`;
  el.title = tooltip;

  el.classList.remove('warning', 'critical');
  const severity = getContextSeverity(pct);
  if (severity) el.classList.add(severity);

  const banner = instance.element.querySelector('.context-banner') as HTMLElement | null;
  if (banner) {
    if (pct < CONTEXT_BANNER_THRESHOLD) {
      instance.contextBannerDismissed = false;
    }
    banner.classList.toggle('hidden', !shouldShowContextBanner(pct, instance.contextBannerDismissed));
  }

  showStatusBar(instance);
}
