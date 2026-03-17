import { appState } from './state.js';
import { initSidebar } from './components/sidebar.js';
import { initTabBar } from './components/tab-bar.js';
import { initSplitLayout } from './components/split-layout.js';
import { initKeybindings } from './keybindings.js';
import { handlePtyData, handlePtyExit, updateCostDisplay } from './components/terminal-pane.js';
import { setIdle, setHookStatus } from './session-activity.js';
import { parseCost, onChange as onCostChange } from './session-cost.js';
import { initConfigSections } from './components/config-sections.js';
import { initNotificationSound } from './notification-sound.js';

async function main(): Promise<void> {
  // Wire PTY data/exit events from main process
  window.claudeIde.pty.onData((sessionId, data) => {
    handlePtyData(sessionId, data);
    parseCost(sessionId, data);
  });

  onCostChange((sessionId, cost) => {
    updateCostDisplay(sessionId, cost);
  });

  window.claudeIde.session.onHookStatus((sessionId, status) => {
    setHookStatus(sessionId, status);
  });

  window.claudeIde.session.onClaudeSessionId((sessionId, claudeSessionId) => {
    // Find the project containing this session and persist the Claude session ID
    const project = appState.projects.find(p => p.sessions.some(s => s.id === sessionId));
    if (project) {
      appState.updateSessionClaudeId(project.id, sessionId, claudeSessionId);
    }
  });

  window.claudeIde.pty.onExit((sessionId, exitCode) => {
    handlePtyExit(sessionId, exitCode);
    setIdle(sessionId);
  });

  // Initialize components
  initSidebar();
  initTabBar();
  initSplitLayout();
  initKeybindings();
  initConfigSections();
  initNotificationSound();

  // Load persisted state
  await appState.load();
}

main().catch(console.error);
