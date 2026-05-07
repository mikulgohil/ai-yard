import { registerAppIpcHandlers } from './ipc/app';
import { registerFsIpcHandlers } from './ipc/fs';
import { registerGitIpcHandlers } from './ipc/git';
import { registerGithubIpcHandlers } from './ipc/github';
import { registerProviderIpcHandlers } from './ipc/provider';
import { registerPtyIpcHandlers, resetHookWatcher as resetPtyHookWatcher } from './ipc/pty';
import { registerSessionIpcHandlers } from './ipc/session';
import { registerStoreIpcHandlers } from './ipc/store';
import { registerMcpHandlers } from './mcp-ipc-handlers';

/**
 * IPC barrel — registers every per-domain handler module exactly once.
 * Each module is responsible for its own channels; this file owns no business
 * logic. See docs/IMPROVEMENTS.md B7 for the extraction history.
 */

/** Re-exported for tests that need to reset the hook-status watcher between runs. */
export function resetHookWatcher(): void {
  resetPtyHookWatcher();
}

export function registerIpcHandlers(): void {
  registerPtyIpcHandlers();
  registerStoreIpcHandlers();
  registerProviderIpcHandlers();
  registerSessionIpcHandlers();
  registerAppIpcHandlers();
  registerFsIpcHandlers();
  registerGitIpcHandlers();
  registerGithubIpcHandlers();
  registerMcpHandlers();
}
